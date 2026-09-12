// Installs the git hooks for a development checkout only. A build machine
// (Vercel sets CI) or a production install has no husky and needs no hooks,
// so `npm install` must not fail there.
if (process.env.CI !== undefined || process.env.NODE_ENV === 'production') process.exit(0);
try {
  const husky = (await import('husky')).default;
  console.log(husky());
} catch {
  // husky not installed: nothing to set up
}
