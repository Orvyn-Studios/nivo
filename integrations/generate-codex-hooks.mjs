import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./codex-hook.mjs', import.meta.url)).replaceAll('\\', '/');
const command = `node "${script}"`;
console.log(JSON.stringify({ description: 'Nivo: estados de Codex sin prompts ni transcripciones', hooks: Object.fromEntries(
  ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'Interrupt'].map(name => [name, [{ hooks: [{ type: 'command', command, timeout: 2 }] }]]),
) }, null, 2));
