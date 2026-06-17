import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'

export async function POST(req: NextRequest) {
  const { path } = await req.json()
  const token = await getDropboxToken()
  const dbx = new Dropbox({ accessToken: token, fetch: fetch })
  const response = await dbx.filesListFolder({ path, recursive: false })
  const files = response.result.entries.filter((e: any) => e['.tag'] === 'file').slice(0, 3)
  return NextResponse.json(files)
}
