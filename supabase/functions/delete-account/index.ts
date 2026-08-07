// Deletes the caller's account. Deployed to Supabase Edge Functions.
//
// WHY THIS EXISTS
//   App Store Review Guideline 5.1.1(v): an app that lets you create an account
//   must let you delete it from inside the app. Supabase can only delete an auth
//   user with the service_role key, and that key must never reach a client — it
//   ignores every row-level security policy in the project. So the key lives
//   here, in a function the client can call but cannot read.
//
//   The client never says WHO to delete. It sends its own access token, this
//   function asks Supabase whose token that is, and deletes exactly that user.
//   A caller cannot delete anyone but themselves even by lying.
//
// DEPLOY
//   supabase functions deploy delete-account --project-ref <your-ref>
//
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform;
//   you do not set them yourself and they never appear in this repository.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'no token' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);

  // Identity comes from the token, never from the request body.
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) {
    return new Response(JSON.stringify({ error: 'bad token' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const uid = who.user.id;

  // Belt and braces: the client deletes its own row first under RLS, but if
  // that policy is missing the row would outlive the account and sit on a
  // public board with no owner. Service role can always remove it.
  await admin.from('scores').delete().eq('user_id', uid);

  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ deleted: true }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
