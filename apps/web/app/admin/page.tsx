/**
 * Admin dashboard entry (ARCHITECTURE.md §8, §16 Phase 1 "Admin dashboard").
 *
 * The web app's primary role beyond the marketing surface is content moderation
 * and management for admins (§11 admin-only). This is the route scaffold; the
 * authenticated dashboard (recording review, publishing, user management) is
 * built alongside the API's admin endpoints.
 */

export default function AdminHome(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-24">
      <h1 className="font-display text-3xl text-ink-primary">Admin</h1>
      <p className="font-body text-ink-secondary">
        Content moderation and archive management for administrators. Requires an
        admin session (built with the API admin endpoints).
      </p>
    </main>
  );
}
