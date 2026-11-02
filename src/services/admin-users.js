const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

async function allProfiles(admin) {
  const profiles = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("profiles")
      .select("id,username,role,status,updated_at")
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new Error("PROFILES_UNAVAILABLE");
    profiles.push(...data);
    if (data.length < PAGE_SIZE) return profiles;
  }
  throw new Error("USER_LIST_TOO_LARGE");
}

async function allAuthUsers(admin) {
  const users = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });
    if (error || !Array.isArray(data?.users))
      throw new Error("AUTH_USERS_UNAVAILABLE");
    for (const user of data.users) users.set(user.id, user);
    if (data.users.length < PAGE_SIZE) return users;
  }
  throw new Error("USER_LIST_TOO_LARGE");
}

// Called only after the route's authenticated Active Admin/SuperAdmin guards.
// Service-role reads do not rely on auth.uid() inside a user-session RPC.
async function listAdminUsers(admin) {
  if (!admin?.auth?.admin?.listUsers || typeof admin.from !== "function")
    throw new Error("ADMIN_CLIENT_UNAVAILABLE");
  const [profiles, authUsers] = await Promise.all([
    allProfiles(admin),
    allAuthUsers(admin),
  ]);
  return profiles
    .map((profile) => {
      const user = authUsers.get(profile.id);
      return {
        id: profile.id,
        username: profile.username,
        email: user?.email || null,
        role: profile.role || "User",
        status: profile.status || "Active",
        joinedAt: user?.created_at || profile.updated_at || null,
        avatarUrl:
          user?.user_metadata?.avatar_url ||
          user?.user_metadata?.picture ||
          null,
      };
    })
    .sort(
      (a, b) =>
        (b.joinedAt || "").localeCompare(a.joinedAt || "") ||
        a.id.localeCompare(b.id),
    );
}
module.exports = { listAdminUsers };
