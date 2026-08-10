import { Resend } from 'resend'

const from = process.env.RESEND_FROM_EMAIL || 'noreply@sdp-paris.com'

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn('RESEND_API_KEY not set — emails will not be sent')
    return null
  }
  return new Resend(key)
}

export async function sendWelcomeEmail(to: string, firstName: string, tempPassword: string) {
  const resend = getClient()
  if (!resend) return
  try {
    await resend.emails.send({
      from,
      to,
      subject: 'Bienvenue sur SDP — Vos identifiants',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0f172a; color: #e2e8f0; border-radius: 12px;">
          <h1 style="color: #818cf8; font-size: 20px; margin-bottom: 16px;">Bienvenue sur SDP</h1>
          <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">Bonjour <strong style="color: #e2e8f0;">${firstName}</strong>,</p>
          <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
            Un administrateur vous a créé un compte. Voici votre mot de passe provisoire :
          </p>
          <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
            <code style="font-size: 24px; letter-spacing: 4px; color: #818cf8; font-weight: bold;">${tempPassword}</code>
          </div>
          <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
            Connectez-vous avec ce mot de passe. Vous devrez le modifier lors de votre première connexion.
          </p>
          <p style="color: #64748b; font-size: 12px; margin-top: 24px;">
            Si vous n'avez pas demandé ce compte, ignorez cet email.
          </p>
        </div>
      `,
    })
    console.log(`Welcome email sent to ${to}`)
  } catch (err) {
    console.error('Failed to send welcome email:', err)
  }
}

export async function sendPasswordChangeConfirmation(to: string, firstName: string) {
  const resend = getClient()
  if (!resend) return
  try {
    await resend.emails.send({
      from,
      to,
      subject: 'SDP — Mot de passe modifié',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0f172a; color: #e2e8f0; border-radius: 12px;">
          <h1 style="color: #818cf8; font-size: 20px; margin-bottom: 16px;">Mot de passe modifié</h1>
          <p style="color: #94a3b8; font-size: 14px;">Bonjour <strong style="color: #e2e8f0;">${firstName}</strong>,</p>
          <p style="color: #94a3b8; font-size: 14px;">Votre mot de passe SDP a bien été modifié.</p>
          <p style="color: #64748b; font-size: 12px; margin-top: 24px;">Si vous n'êtes pas à l'origine de cette modification, contactez un administrateur.</p>
        </div>
      `,
    })
  } catch (err) {
    console.error('Failed to send confirmation email:', err)
  }
}
