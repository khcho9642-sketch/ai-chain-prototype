import { handleAuthRequest } from '../../../server/member/google-auth.mjs'

export const onRequest = ({ request, env }) => handleAuthRequest(request, env)
