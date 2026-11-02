async function authorAvatars(admin, userIds) {
  const avatars = new Map();
  if (admin.auth?.admin?.getUserById) {
    const ids = [...new Set(userIds)];
    // Resolve each author once, with bounded concurrency. Avatar failure must not hide builds.
    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(ids.slice(i, i + 10).map(async (id) => {
        try {
          const { data: account, error } = await admin.auth.admin.getUserById(id);
          if (error) return;
          const metadata = account?.user?.user_metadata;
          const url = metadata?.avatar_url || metadata?.picture;
          if (typeof url === "string" && /^https?:\/\//i.test(url)) avatars.set(id, url);
        } catch { /* Use the default profile icon. */ }
      }));
    }
  }
  return avatars;
}
module.exports = { authorAvatars };
