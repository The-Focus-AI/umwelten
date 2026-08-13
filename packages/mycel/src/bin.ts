/**
 * The Exchange as its own executable.
 *
 * `umwelten mycel …` reaches this same command through the full CLI, which
 * depends on habitat, ui, sessions and evaluation — Ink, React, discord.js and
 * a natively-compiled sqlite among them. That is the right entry point on a
 * developer's machine, where all of it is already installed.
 *
 * It is the wrong one for the container. The Exchange itself needs three
 * packages, and routing its production entry through the whole CLI is what made
 * the image 3.36 GB and the deploy ten minutes. This entry exists so the
 * container can run the Exchange and nothing else.
 */
import { mycelCommand } from "./command.js";

await mycelCommand.parseAsync(process.argv);
