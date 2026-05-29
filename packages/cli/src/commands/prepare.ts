import { Command } from 'commander';
import { prepareSession, listAdapters } from '@pulsemcp/air-sdk';

export function registerPrepareCommand(program: Command): void {
  const adapters = listAdapters();
  const adapterList = adapters.length > 0 ? adapters.join(', ') : 'none installed';

  program
    .command('prepare')
    .description(
      `Prepare a working directory for an agent session without starting the agent. ${'\\n'}Writes adapter config files and injects skills, but does not launch the agent process. Supported adapters: ${adapterList}.`,
    )
    .argument('<adapter>', `Adapter to use for preparation (${adapterList})`)
    .argument(
      '[directory]',
      'Target directory to prepare (defaults to the current working directory)',
    )
    .option('--root <root>', 'Root artifact ID to scope skills and servers to')
    .option('--dry-run', 'Preview the files that would be written without modifying the directory')
    .action(async (adapter, directory, options) => {
      try {
        await prepareSession(adapter, directory, options);
      } catch (err) {
        process.exit(1);
      }
    });
}
