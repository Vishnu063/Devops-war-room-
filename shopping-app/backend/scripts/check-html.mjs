import { HtmlValidate } from 'html-validate';
import { readdir } from 'node:fs/promises';
const validator = new HtmlValidate({
  elements: ['html5'],
  rules: {
    'close-attr': 'error',
    'close-order': 'error',
    'element-permitted-content': 'error',
    'no-dup-id': 'error',
    'element-required-attributes': 'error',
    'wcag/h32': 'error',
  },
});
if ((await validator.validateString('<select><option>A</option value="bad"></select>')).valid)
  throw new Error('HTML checker did not reject the malformed payment option regression');
let failures = 0;
for (const name of await readdir(new URL('../../', import.meta.url))) {
  if (!name.endsWith('.html')) continue;
  const path = new URL('../../' + name, import.meta.url),
    result = await validator.validateFile(path.pathname);
  if (!result.valid) {
    failures++;
    for (const file of result.results)
      for (const message of file.messages)
        console.error(`${name}:${message.line} ${message.ruleId}: ${message.message}`);
  }
}
if (failures) process.exitCode = 1;
else console.log('HTML structure, required attributes and unique IDs passed');
