#!/usr/bin/env node

import { Command } from "commander";
import { validateCommand } from "./commands/validate.js";
import { startCommand } from "./commands/start.js";
import { listCommand } from "./commands/list.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("air")
  .description("AIR \u2014 Agent Infrastructure Repository CLI")
  .version("0.0.1");

program.addCommand(validateCommand());
program.addCommand(startCommand());
program.addCommand(listCommand());
program.addCommand(initCommand());

program.parseAsync();
