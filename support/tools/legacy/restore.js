import { execSync } from 'child_process';
try {
  const output = execSync('git checkout -- web-client/src/components/squad-admin/PlayerDetailDrawer.vue', { cwd: 'd:\\BZSS_Panel' });
  console.log('Success:', output.toString());
} catch (e) {
  console.error('Error:', e.message);
}
