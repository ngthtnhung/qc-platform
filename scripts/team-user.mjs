/**
 * Quản lý người dùng nhóm. Chạy trên máy server, khi server đang tắt:
 *   node scripts/team-user.mjs add "Tên người dùng" admin|member   -> in token một lần
 *   node scripts/team-user.mjs list
 *   node scripts/team-user.mjs reset <id>      -> cấp token mới (token cũ mất hiệu lực)
 *   node scripts/team-user.mjs revoke <id>
 *   node scripts/team-user.mjs access <id> member secrets,rules   -> cấp quyền lẻ (environments, secrets, rules); '-' để xóa hết
 *   node scripts/team-user.mjs access <id> admin                  -> nâng lên admin (có mọi quyền)
 */
import { db } from '../database/db.js';
import { createUser, resetToken, revokeUser, setUserAccess, PERMS } from '../packages/team-auth/auth.js';

const [cmd, a, b] = process.argv.slice(2);
await db.init();

if (cmd === 'add' && a) {
  const { user, token } = await createUser(a, b || 'member');
  console.log(`Đã tạo ${user.display_name} (${user.role}), id ${user.id}.`);
  console.log(`Token (chỉ hiện một lần, gửi riêng cho người đó): ${token}`);
} else if (cmd === 'list') {
  (await db.find('team_users')).forEach(u => console.log(`${u.id}  ${u.display_name}  ${u.role}  ${u.is_active ? 'đang dùng' : 'đã thu hồi'}`));
} else if (cmd === 'reset' && a) {
  console.log(`Token mới: ${await resetToken(a)}`);
} else if (cmd === 'revoke' && a) {
  await revokeUser(a); console.log('Đã thu hồi.');
} else if (cmd === 'access' && a) {
  // access <id> [admin|member] [environments,secrets,rules|-]
  const role = ['admin', 'member'].includes(b) ? b : undefined;
  const permsArg = role ? process.argv[5] : b;
  const perms = permsArg === undefined ? undefined : permsArg === '-' ? [] : permsArg.split(',');
  const u = await setUserAccess(a, { role, perms });
  console.log(`${u.display_name}: vai trò ${u.role}, quyền lẻ: ${(u.perms || []).join(', ') || 'không'}`);
} else {
  console.log('Dùng: add "Tên" admin|member | list | reset <id> | revoke <id> | access <id> [admin|member] [' + PERMS.join(',') + '|-]');
}
