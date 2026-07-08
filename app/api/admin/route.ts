import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'terry@hedonistasmezcal.com'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function verifyAdmin(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  const supabase = getAdminClient()
  const { data: { user } } = await supabase.auth.getUser(token)
  return user?.email === ADMIN_EMAIL
}

export async function GET(req: NextRequest) {
  if (!await verifyAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const supabase = getAdminClient()
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const { data: permissions } = await supabase.from('user_permissions').select('*')
  const permMap = new Map((permissions || []).map((p: any) => [p.email, p]))
  const result = (users || []).map((u: any) => ({
    id: u.id, email: u.email, created_at: u.created_at, last_sign_in: u.last_sign_in_at,
    permissions: permMap.get(u.email) || null
  }))
  return NextResponse.json({ users: result })
}

export async function POST(req: NextRequest) {
  if (!await verifyAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { email, password, permissions } = await req.json()
  if (!email || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  const supabase = getAdminClient()
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (userError) return NextResponse.json({ error: userError.message }, { status: 400 })
  await supabase.from('user_permissions').upsert({
    email,
    can_download: permissions?.can_download ?? true,
    can_dropbox: permissions?.can_dropbox ?? true,
    can_delete: permissions?.can_delete ?? false,
    can_dedup: permissions?.can_dedup ?? false,
    can_choose_folder: permissions?.can_choose_folder ?? false,
    can_upload: permissions?.can_upload ?? true,
  })
  return NextResponse.json({ success: true, user: userData.user })
}

export async function PATCH(req: NextRequest) {
  if (!await verifyAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { email, permissions, newPassword } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })
  const supabase = getAdminClient()
  if (newPassword) {
    const { data: { users } } = await supabase.auth.admin.listUsers()
    const user = users.find((u: any) => u.email === email)
    if (user) await supabase.auth.admin.updateUserById(user.id, { password: newPassword })
  }
  if (permissions) await supabase.from('user_permissions').upsert({ email, ...permissions })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  if (!await verifyAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { email } = await req.json()
  if (!email || email === ADMIN_EMAIL) return NextResponse.json({ error: 'Cannot delete this user' }, { status: 400 })
  const supabase = getAdminClient()
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const user = users.find((u: any) => u.email === email)
  if (user) await supabase.auth.admin.deleteUser(user.id)
  await supabase.from('user_permissions').delete().eq('email', email)
  return NextResponse.json({ success: true })
}
