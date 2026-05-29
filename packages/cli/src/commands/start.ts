import { Command } from 'commander';
import { startSession, listAdapters } from '@pulsemcp/air-sdk';

export function registerStartCommand(program: Command): void {
  const adapters = listAdapters();
  const adapterList = adapters.length > 0 ? adapters.join(', ') : 'none installed';

  program
    .command('start')
    .description(
      `Start an agent session: prepare the working directory, then launch the agent. ${'\\n'}Combines the work of 'prepare' with launching the agent process. Supported adapters: ${adapterList}.`,
    )
    .argument('<adapter>', `Adapter to use for the session (${adapterList})`)
    .argument(
      '[directory]',
      'Target directory for the session (defaults to the current working directory)',
    )
    .option('--root <root>', 'Root artifact ID to scope skills and servers to')
    .option('--dry-run', 'Preview what would be done without writing files or launching the agent')
    .action(async (adapter, directory, options) => {
      try {
        await startSession(adapter, directory, options);
      } catch (err) {
        process.exit(1);
      }
    });
}
