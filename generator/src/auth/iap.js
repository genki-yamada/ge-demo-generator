import { OAuth2Client } from 'google-auth-library';

const IAP_JWT_HEADER = 'x-goog-iap-jwt-assertion';
const IAP_ISSUERS = ['https://cloud.google.com/iap'];

// IAP が付与する JWT アサーションを検証し payload を返す。
// audience は IAP の設定値（Plan A の runbook 参照）。
export async function verifyIapJwt(token, audience, client = new OAuth2Client()) {
  const { pubkeys } = await client.getIapPublicKeys();
  const ticket = await client.verifySignedJwtWithCertsAsync(
    token,
    pubkeys,
    audience,
    IAP_ISSUERS,
  );
  return ticket.getPayload();
}

// Express ミドルウェアを生成する。verify は注入可能（テスト用）。
export function iapAuth({ audience, verify = verifyIapJwt, devUserEmail = null }) {
  return async function iapAuthMiddleware(req, res, next) {
    const token = req.header(IAP_JWT_HEADER);
    if (!token) {
      if (devUserEmail) {
        req.user = { email: devUserEmail };
        return next();
      }
      return res.status(401).json({ error: 'missing IAP assertion' });
    }
    try {
      const payload = await verify(token, audience);
      req.user = { email: payload.email, sub: payload.sub };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid IAP assertion' });
    }
  };
}
