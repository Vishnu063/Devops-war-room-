import { node } from './ui.js';
let serial = 0;
export function field(
  label,
  name,
  { type = 'text', value = '', required = true, options, minLength, maxLength } = {},
) {
  const wrapper = node('label', '', label);
  const input = node(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
  input.name = name;
  input.id = 'field-' + ++serial;
  wrapper.htmlFor = input.id;
  if (!options && type !== 'textarea') input.type = type;
  if (options)
    for (const [v, title] of options) {
      const option = node('option', '', title);
      option.value = v;
      input.append(option);
    }
  if (!options || value !== '') input.value = value;
  input.required = required;
  if (minLength) input.minLength = minLength;
  if (maxLength) input.maxLength = maxLength;
  if (type === 'checkbox') {
    input.checked = !!value;
    input.required = false;
  }
  wrapper.append(input);
  return { wrapper, input };
}
export function form(fields, label, onSubmit) {
  const f = node('form', 'formGrid');
  for (const item of fields) f.append(item.wrapper);
  const submit = node('button', 'primary', label),
    status = node('p');
  status.setAttribute('role', 'status');
  f.append(submit, status);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(f)), f);
      status.textContent = 'Saved';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  return f;
}
