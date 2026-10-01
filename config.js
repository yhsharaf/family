// Shared features (guestbook, guild-wide whip & stew counters, photo votes, photo uploads) need a free Supabase
// project. Follow README.md, then paste your Project URL and publishable ("anon") key below.
// Leave them empty and the site still works: those features just show "coming soon" and counters stay on your device.
window.FAMILY_CONFIG = {
  supabaseUrl: "https://nycqyskcxhwjjqamznsf.supabase.co",   // e.g. "https://abcdefgh.supabase.co"
  supabaseKey: "sb_publishable_VfdyxAlTSfwq4t1Zwph24A_GUqMug69",   // the publishable / anon key (it is meant to be public; never put the service_role key here)
  uploads: true,     // false = hide the "add a memory" upload form
};
