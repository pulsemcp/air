import { Command } from "commander";
import {
  getAirJsonPath,
  resolveArtifacts,
  emptyArtifacts,
} from "@pulsemcp/air-core";

type ListType =
  | "skills"
  | "mcp"
  | "plugins"
  | "roots"
  | "hooks"
  | "references";

const VALID_TYPES: ListType[] = [
  "skills",
  "mcp",
  "plugins",
  "roots",
  "hooks",
  "references",
];

export function listCommand(): Command {
  const cmd = new Command("list")
    .description(
      "List available artifacts (skills, mcp, plugins, roots, hooks, references)"
    )
    .argument(
      "<type>",
      "Artifact type to list: skills, mcp, plugins, roots, hooks, references"
    )
    .action(async (type: string) => {
      if (!VALID_TYPES.includes(type as ListType)) {
        console.error(
          `Error: Unknown artifact type "${type}". Valid types: ${VALID_TYPES.join(", ")}`
        );
        process.exit(1);
      }

      const airJsonPath = getAirJsonPath();
      const artifacts = airJsonPath
        ? await resolveArtifacts(airJsonPath)
        : emptyArtifacts();

      const listType = type as ListType;

      switch (listType) {
        case "skills": {
          const entries = Object.entries(artifacts.skills);
          if (entries.length === 0) {
            console.log("No skills found.");
            return;
          }
          console.log(`Skills (${entries.length}):\n`);
          for (const [id, skill] of entries) {
            const title = skill.title ? ` (${skill.title})` : "";
            console.log(`  ${id}${title}`);
            console.log(`    ${skill.description}`);
            if (skill.references && skill.references.length > 0) {
              console.log(
                `    References: ${skill.references.join(", ")}`
              );
            }
            console.log();
          }
          break;
        }

        case "mcp": {
          const entries = Object.entries(artifacts.mcp);
          if (entries.length === 0) {
            console.log("No MCP servers found.");
            return;
          }
          console.log(`MCP Servers (${entries.length}):\n`);
          for (const [id, server] of entries) {
            const title = server.title ? ` (${server.title})` : "";
            console.log(`  ${id}${title}`);
            if (server.description) {
              console.log(`    ${server.description}`);
            }
            console.log(`    Type: ${server.type}`);
            console.log();
          }
          break;
        }

        case "plugins": {
          const entries = Object.entries(artifacts.plugins);
          if (entries.length === 0) {
            console.log("No plugins found.");
            return;
          }
          console.log(`Plugins (${entries.length}):\n`);
          for (const [id, plugin] of entries) {
            const title = plugin.title ? ` (${plugin.title})` : "";
            console.log(`  ${id}${title}`);
            console.log(`    ${plugin.description}`);
            console.log(
              `    Command: ${plugin.command} ${(plugin.args || []).join(" ")}`
            );
            console.log();
          }
          break;
        }

        case "roots": {
          const entries = Object.entries(artifacts.roots);
          if (entries.length === 0) {
            console.log("No roots found.");
            return;
          }
          console.log(`Roots (${entries.length}):\n`);
          for (const [id, root] of entries) {
            const displayName = root.display_name || id;
            console.log(`  ${id} (${displayName})`);
            console.log(`    ${root.description}`);
            if (root.url) {
              console.log(`    URL: ${root.url}`);
            }
            if (root.default_mcp_servers?.length) {
              console.log(
                `    MCP Servers: ${root.default_mcp_servers.join(", ")}`
              );
            }
            if (root.default_skills?.length) {
              console.log(
                `    Skills: ${root.default_skills.join(", ")}`
              );
            }
            console.log();
          }
          break;
        }

        case "hooks": {
          const entries = Object.entries(artifacts.hooks);
          if (entries.length === 0) {
            console.log("No hooks found.");
            return;
          }
          console.log(`Hooks (${entries.length}):\n`);
          for (const [id, hook] of entries) {
            const title = hook.title ? ` (${hook.title})` : "";
            console.log(`  ${id}${title}`);
            console.log(`    ${hook.description}`);
            console.log(`    Event: ${hook.event}`);
            console.log();
          }
          break;
        }

        case "references": {
          const entries = Object.entries(artifacts.references);
          if (entries.length === 0) {
            console.log("No references found.");
            return;
          }
          console.log(`References (${entries.length}):\n`);
          for (const [id, ref] of entries) {
            const title = ref.title ? ` (${ref.title})` : "";
            console.log(`  ${id}${title}`);
            console.log(`    ${ref.description}`);
            console.log(`    File: ${ref.file}`);
            console.log();
          }
          break;
        }
      }
    });

  return cmd;
}
