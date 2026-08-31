/** GitHub administration boundary used only for audited project provisioning. */
export interface GithubAdministration {
  organization: string;
  installationId: string;
  createPrivateRepository(
    name: string,
    description?: string,
  ): Promise<{ id: number; htmlUrl: string; cloneUrl: string }>;
  addRepositoryToInstallation(repositoryId: number): Promise<void>;
  removeRepositoryFromInstallation(repositoryId: number): Promise<void>;
  deleteRepository(name: string): Promise<void>;
}

export function createGithubAdministration(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = globalThis.fetch,
): GithubAdministration | undefined {
  const organization = env.GITHUB_ADMIN_ORGANIZATION?.trim();
  const token = env.GITHUB_ADMIN_TOKEN?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  if (!organization || !token || !installationId) return undefined;
  const request = async (
    path: string,
    init: RequestInit,
  ): Promise<Response> => {
    const response = await fetcher(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (!response.ok)
      throw new Error(
        `GitHub ${init.method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    return response;
  };
  return {
    organization,
    installationId,
    async createPrivateRepository(name, description) {
      const response = await request(
        `/orgs/${encodeURIComponent(organization)}/repos`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            description,
            private: true,
            visibility: "private",
          }),
        },
      );
      const repo = (await response.json()) as {
        id: number;
        html_url: string;
        clone_url: string;
      };
      return { id: repo.id, htmlUrl: repo.html_url, cloneUrl: repo.clone_url };
    },
    async addRepositoryToInstallation(id) {
      await request(
        `/user/installations/${installationId}/repositories/${id}`,
        { method: "PUT" },
      );
    },
    async removeRepositoryFromInstallation(id) {
      await request(
        `/user/installations/${installationId}/repositories/${id}`,
        { method: "DELETE" },
      );
    },
    async deleteRepository(name) {
      await request(
        `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
    },
  };
}
