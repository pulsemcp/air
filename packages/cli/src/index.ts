#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { validateCommand } from "./commands/validate.js";
import { startCommand } from "./commands/start.js";
import { prepareCommand } from "./commands/prepare.js";
import { listCommand } from "./commands/list.js";
import { initCommand } from "./commands/init.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("air")
  .description("AIR \u2014 Agent Infrastructure Repository CLI")
  .version(version);

program.addCommand(validateCommand());
program.addCommand(startCommand());
program.addCommand(prepareCommand());
program.addCommand(listCommand());
program.addCommand(initCommand());

program.parseAsync();
