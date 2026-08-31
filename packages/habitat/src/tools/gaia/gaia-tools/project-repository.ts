import { tool, type Tool } from "ai";
import { z } from "zod";
import type { AuditOperation } from "../credential-audit.js";
import type { GaiaToolsContext } from "./context.js";
import { startHabitatContainer } from "./habitats.js";

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One fail-closed operation for the ADR 0035 project bootstrap. */
export function createProjectRepositoryTools(
  ctx: GaiaToolsContext,
): Record<string, Tool> {
  return {
    create_private_project_habitat: tool({
      description:
        "Create a private repository in Gaia's configured GitHub organisation, explicitly add exactly it to the GitHub App installation, register a coding Habitat with explicit write scope to that Owned repo, and start it. Requires GITHUB_ADMIN_ORGANIZATION and a GITHUB_ADMIN_TOKEN with organisation repository creation/deletion and installation repository administration write access.",
      inputSchema: z.object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+$/),
        habitatId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
      }),
      execute: async (params) => {
        const github = ctx.githubAdministration;
        if (!github || !ctx.githubTokens?.enabled) {
          throw new Error(
            "GitHub administration-write is not configured. Set GITHUB_ADMIN_ORGANIZATION, GITHUB_ADMIN_TOKEN, and the complete GITHUB_APP_* configuration; refusing to create anything.",
          );
        }
        const state: Record<string, unknown> = {
          organization: github.organization,
          repository: params.repository,
          installationId: github.installationId,
          repositoryCreated: false,
          installationAccess: false,
          habitatRegistered: false,
          habitatStarted: false,
        };
        const audit = async (
          operation: AuditOperation,
          details: Record<string, unknown>,
        ) =>
          ctx.audit.log({
            timestamp: new Date().toISOString(),
            operation,
            habitatId: params.habitatId,
            repositories: [params.repository],
            details,
          });
        const reconcile = (failedAt: string, error: unknown) =>
          JSON.stringify(
            {
              ok: false,
              failedAt,
              error: message(error),
              reconciliation: state,
            },
            null,
            2,
          );
        let repositoryId: number | undefined;
        try {
          await audit("github_repository_create", {
            phase: "intent",
            visibility: "private",
            organization: github.organization,
          });
          const repository = await github.createPrivateRepository(
            params.repository,
            params.description,
          );
          repositoryId = repository.id;
          Object.assign(state, {
            repositoryCreated: true,
            repositoryId,
            repositoryUrl: repository.htmlUrl,
          });
        } catch (error) {
          return reconcile("create_repository", error);
        }

        try {
          await audit("github_installation_repository_add", {
            phase: "intent",
            repositoryId,
          });
          await github.addRepositoryToInstallation(repositoryId);
          state.installationAccess = true;
        } catch (error) {
          try {
            await audit("github_repository_delete", {
              phase: "rollback_intent",
              repositoryId,
              causedBy: message(error),
            });
            await github.deleteRepository(params.repository);
            state.repositoryCreated = false;
          } catch (rollbackError) {
            state.rollbackError = message(rollbackError);
          }
          return reconcile("add_installation_access", error);
        }

        try {
          await audit("github_project_register", {
            phase: "intent",
            repositoryId,
            write: [params.repository],
          });
          await ctx.registry.create({
            id: params.habitatId,
            name: params.name,
            gitUrl: `https://github.com/${github.organization}/${params.repository}.git`,
            provider: params.provider ?? ctx.gaiaProvider ?? "openrouter",
            model: params.model ?? ctx.gaiaModel ?? "anthropic/claude-sonnet-5",
            image: "habitat-coding",
            github: { write: [params.repository] },
          });
          state.habitatRegistered = true;
        } catch (error) {
          try {
            await audit("github_installation_repository_remove", {
              phase: "rollback_intent",
              repositoryId,
            });
            await github.removeRepositoryFromInstallation(repositoryId);
            state.installationAccess = false;
          } catch (rollbackError) {
            state.installationRollbackError = message(rollbackError);
          }
          try {
            await audit("github_repository_delete", {
              phase: "rollback_intent",
              repositoryId,
            });
            await github.deleteRepository(params.repository);
            state.repositoryCreated = false;
          } catch (rollbackError) {
            state.repositoryRollbackError = message(rollbackError);
          }
          return reconcile("register_habitat", error);
        }

        try {
          await audit("github_project_start", {
            phase: "intent",
            repositoryId,
          });
          const port = await startHabitatContainer(ctx, params.habitatId);
          state.habitatStarted = true;
          state.containerPort = port;
          return JSON.stringify({ ok: true, ...state }, null, 2);
        } catch (error) {
          // Keep the complete, valid project registration. Retrying start is safe;
          // deleting a repo after a container boundary failure is not.
          state.nextAction = `Fix the container failure, then call start_habitat for ${params.habitatId}`;
          return reconcile("start_habitat", error);
        }
      },
    }),
  };
}
