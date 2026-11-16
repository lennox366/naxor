import { parseJsonToolCalls, parseFunctionTagCalls } from './agent.bundle.mjs';
const content = `Kopieren
{
  "name": "search_files",
  "arguments": {
    "query": "feedbackChannelId",
    "path": "config/settings.json"
  }
}
\`\`\`{"name": "list_dir", "arguments": {"path": "."}}
{"name": "search_files", "arguments": {"query": "feedbackChannelId", "path": "."}}
{"name": "edit_file", "arguments": {"path": "config/settings.json", "old_text": "feedbackChannelId: 1234567890123", "new_text": "feedbackChannelId: 1569408831300042793"}}
{"name": "run_test", "arguments": {"command": "tsc --noEmit", "expect": "", "expect_exit": 0}}
{"name": "run_command", "arguments": {"command": "node --check"}}
`;
const r = parseJsonToolCalls(content);
console.log('parseJsonToolCalls:', r.length, JSON.stringify(r.map(x => x.name)));
const t = parseFunctionTagCalls(content);
console.log('parseFunctionTagCalls:', t.length);
