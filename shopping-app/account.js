import { $, api, node, button, money, notify } from './ui.js';
let user;
import { field, form } from './forms.js';
export { field, form } from './forms.js';
function panel(title) {
  const root = $('accountContent');
  root.replaceChildren(node('h3', '', title));
  return root;
}
export async function refreshAccount(account) {
  user = account;
  $('authForm').hidden = !!account;
  $('accountTools').hidden = !account;
  if (account) {
    $('accountSummary').textContent =
      account.email +
      ' · ' +
      (account.emailVerified ? 'Email verified' : 'Email not verified') +
      (account.role === 'OWNER'
        ? ' · Owner ' + (account.mfaEnabled ? 'MFA enabled' : 'MFA not enrolled')
        : '');
    $('mfaTools').hidden = account.role !== 'OWNER';
  }
}
$('notificationsButton').addEventListener('click', async () => {
  try {
    const root = panel('Notifications');
    for (const row of (await api('/api/notifications')).items)
      root.append(node('p', '', new Date(row.created_at).toLocaleString() + ' · ' + row.title));
    if (root.children.length === 1) root.append(node('p', '', 'No notifications yet.'));
  } catch (e) {
    notify(e.message);
  }
});
$('preferencesButton').addEventListener('click', async () => {
  try {
    const p = await api('/api/preferences'),
      root = panel('Your consent preferences');
    root.append(
      form(
        [
          field('Email offers and saved-bag reminders', 'marketing', {
            type: 'checkbox',
            value: p.marketing,
          }),
          field('Remember recently viewed products', 'personalization', {
            type: 'checkbox',
            value: p.personalization,
          }),
          field('Allow anonymous aggregate interaction counts', 'analytics', {
            type: 'checkbox',
            value: p.analytics,
          }),
        ],
        'Save preferences',
        async (_, f) => {
          await api(
            '/api/preferences',
            'PUT',
            Object.fromEntries(
              ['marketing', 'personalization', 'analytics'].map((k) => [k, f.elements[k].checked]),
            ),
          );
        },
      ),
    );
    root.append(
      node(
        'p',
        'muted',
        'Optional choices default off. Turning personalization off clears recently viewed history. Essential order records remain.',
      ),
    );
  } catch (e) {
    notify(e.message);
  }
});
$('creditButton').addEventListener('click', async () => {
  try {
    const credit = await api('/api/credit'),
      root = panel('Store credit and points');
    root.append(
      node('p', '', 'Available credit: ' + money(credit.balancePaise)),
      node('p', '', 'Loyalty ledger: ' + credit.loyaltyPoints + ' points (not cash)'),
    );
    root.append(
      form(
        [field('Gift credit code', 'code', { type: 'password', minLength: 24, maxLength: 24 })],
        'Redeem credit',
        async (data) => {
          const r = await api('/api/gift-cards/redeem', 'POST', data);
          notify('Available credit: ' + money(r.balancePaise));
        },
      ),
    );
  } catch (e) {
    notify(e.message);
  }
});
$('addressesButton').addEventListener('click', async () => {
  try {
    const root = panel('Saved addresses');
    for (const a of (await api('/api/addresses')).items)
      root.append(
        node('p', '', [a.recipient, a.line1, a.city, a.pincode].join(' · ')),
        button('Remove address', async () => {
          await api('/api/addresses/' + a.id, 'DELETE', {});
          $('addressesButton').click();
        }),
      );
    root.append(
      form(
        [
          field('Recipient name', 'recipient', { maxLength: 100 }),
          field('Mobile number', 'phone', { type: 'tel' }),
          field('Street address', 'line1', { maxLength: 200 }),
          field('Apartment or landmark', 'line2', { required: false, maxLength: 200 }),
          field('City', 'city', { maxLength: 100 }),
          field('State', 'state', { maxLength: 100 }),
          field('PIN', 'pincode', { minLength: 6, maxLength: 6 }),
        ],
        'Save encrypted address',
        async (data) => {
          await api('/api/addresses', 'POST', data);
          notify('Address saved');
        },
      ),
    );
  } catch (e) {
    notify(e.message);
  }
});
$('supportButton').addEventListener('click', () => showSupport().catch((e) => notify(e.message)));
async function showSupport() {
  const root = panel('Customer support');
  for (const t of (await api('/api/support')).items) {
    const card = node('article', 'orderCard');
    card.append(node('h4', '', t.subject), node('p', '', t.status));
    for (const m of t.messages) card.append(node('p', '', m.author + ': ' + m.body));
    card.append(
      form(
        [field('Your reply', 'message', { type: 'textarea', maxLength: 3000 })],
        'Send reply',
        async (data) => {
          await api('/api/support/' + t.id, 'POST', data);
          await showSupport();
        },
      ),
    );
    root.append(card);
  }
  root.append(
    form(
      [
        field('Subject', 'subject', { minLength: 3, maxLength: 150 }),
        field('Message', 'message', { type: 'textarea', minLength: 5, maxLength: 3000 }),
      ],
      'Open support ticket',
      async (data) => {
        await api('/api/support', 'POST', data);
        await showSupport();
      },
    ),
  );
}
$('recentButton').addEventListener('click', async () => {
  try {
    const root = panel('Recently viewed');
    const r = await api('/api/recent');
    if (r.consentRequired)
      root.append(
        node('p', '', 'Enable personalization in consent preferences to remember products.'),
      );
    for (const p of r.items) {
      const a = node('a', '', p.name);
      a.href = '/?product=' + encodeURIComponent(p.id);
      root.append(a);
    }
  } catch (e) {
    notify(e.message);
  }
});
$('privacyButton').addEventListener('click', () => {
  const root = panel('Your application data');
  const download = node('a', 'primary', 'Download personal data');
  download.href = '/api/privacy/export';
  download.download = '';
  root.append(
    download,
    node(
      'p',
      'muted',
      'Erasure removes direct personal fields and revokes sessions. Pseudonymous transaction records remain; provider and backup retention require the owner policy. Active orders, unresolved refunds or store credit must be resolved first.',
    ),
  );
  root.append(
    form(
      [
        field('Confirm your password', 'password', { type: 'password' }),
        field('Type DELETE to request erasure', 'confirmation'),
      ],
      'Delete my customer account',
      async (data) => {
        await api('/api/privacy/delete', 'POST', data);
        location.reload();
      },
    ),
  );
});
$('verifyEmailButton').addEventListener('click', async () => {
  try {
    const r = await api('/api/auth/resend-verification', 'POST', { email: user.email });
    notify(r.message);
  } catch (e) {
    notify(e.message);
  }
});
$('revokeSessionsButton').addEventListener('click', async () => {
  try {
    await api('/api/auth/revoke-all', 'POST', {});
    location.reload();
  } catch (e) {
    notify(e.message);
  }
});
$('mfaTools').addEventListener('click', () => {
  const root = panel('Owner authenticator enrollment');
  root.append(
    node(
      'p',
      '',
      'Keep the enrollment secret private. Existing owner MFA requires a recent verified session before replacement.',
    ),
  );
  root.append(
    form(
      [field('Confirm owner password', 'password', { type: 'password' })],
      'Begin authenticator setup',
      async (data) => {
        const r = await api('/api/auth/mfa/setup', 'POST', data);
        const secret = node('code', '', r.secret);
        root.append(
          node('p', '', 'Enter this secret in an authenticator, then confirm its current code:'),
          secret,
        );
        root.append(
          form(
            [field('Current six-digit code', 'code', { minLength: 6, maxLength: 6 })],
            'Enable authenticator',
            async (data) => {
              await api('/api/auth/mfa/confirm', 'POST', data);
              root.replaceChildren(
                node(
                  'p',
                  '',
                  'MFA enabled; sessions rotated. Sign in using password and a new authenticator code when this session expires.',
                ),
              );
            },
          ),
        );
      },
    ),
  );
});
$('forgotPasswordButton').addEventListener('click', () => {
  const root = panel('Reset password');
  root.append(
    form(
      [field('Account email', 'email', { type: 'email' })],
      'Queue reset email',
      async (data) => {
        const result = await api('/api/auth/forgot-password', 'POST', data);
        notify(result.message);
      },
    ),
  );
});
export async function identityLink() {
  const match = location.hash.match(/^#(verify|reset)=([A-Za-z0-9_-]{43})$/);
  if (!match) return;
  history.replaceState(null, '', location.pathname);
  $('accountDialog').showModal();
  if (match[1] === 'verify') {
    try {
      await api('/api/auth/verify-email', 'POST', { token: match[2] });
      panel('Email verified').append(node('p', '', 'Your one-use verification link was accepted.'));
    } catch (e) {
      panel('Verification').append(node('p', '', e.message));
    }
  } else {
    const root = panel('Choose a new password');
    root.append(
      form(
        [field('New password', 'password', { type: 'password', minLength: 12, maxLength: 128 })],
        'Reset password',
        async (data) => {
          await api('/api/auth/reset-password', 'POST', {
            token: match[2],
            password: data.password,
          });
          root.replaceChildren(
            node('p', '', 'Password changed. Previous sessions are revoked; sign in again.'),
          );
        },
      ),
    );
  }
}

$('accountDialog').addEventListener('close', () => {
  $('accountContent').replaceChildren();
});

export async function openSupport() {
  await showSupport();
  $('accountDialog').showModal();
}
