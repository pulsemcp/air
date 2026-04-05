import { Command } from "commander";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { getDefaultAirJsonPath } from "@pulsemcp/air-core";

export function initCommand(): Command {
  const cmd = new Command("init")
    .description("Initialize a new AIR configuration at ~/.air/")
    .action(() => {
      const airJsonPath = getDefaultAirJsonPath();
      const airDir = dirname(airJsonPath);

      if (existsSync(airJsonPath)) {
        console.error(`Error: ${airJsonPath} already exists.`);
        process.exit(1);
      }

      mkdirSync(airDir, { recursive: true });

      const airJson = {
        name: "my-config",
        description: "",
        skills: ["./skills/skills.json"],
        references: ["./references/references.json"],
        mcp: ["./mcp/mcp.json"],
        plugins: ["./plugins/plugins.json"],
        roots: ["./roots/roots.json"],
        hooks: ["./hooks/hooks.json"],
      };

      const emptyIndex = () => "{}\n";

      writeFileSync(
        airJsonPath,
        JSON.stringify(airJson, null, 2) + "\n"
      );

      const files: [string, string][] = [
        ["skills/skills.json", emptyIndex()],
        ["references/references.json", emptyIndex()],
        ["mcp/mcp.json", emptyIndex()],
        ["plugins/plugins.json", emptyIndex()],
        ["roots/roots.json", emptyIndex()],
        ["hooks/hooks.json", emptyIndex()],
      ];

      for (const [filename, content] of files) {
        const filePath = resolve(airDir, filename);
        mkdirSync(dirname(filePath), { recursive: true });
        if (!existsSync(filePath)) {
          writeFileSync(filePath, content);
        }
      }

      console.log(`Initialized AIR configuration at ${airDir}/:`);
      console.log("  air.json");
      for (const [filename] of files) {
        console.log(`  ${filename}`);
      }
      console.log(
        "\nEdit air.json to configure your setup. Run 'air validate ~/.air/air.json' to check."
      );
    });

  return cmd;
}
