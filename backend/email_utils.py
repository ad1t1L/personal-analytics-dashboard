import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from backend.config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, FROM_EMAIL, APP_BASE_URL


def _send(to: str, subject: str, html_body: str) -> None:
    """
    Internal helper.  Opens a TLS connection to the SMTP server, sends one
    email, and closes cleanly.

    WHY TLS (STARTTLS on port 587):
    Encrypts the connection between your server and the mail relay so that
    credentials and message content are not visible on the network.
    """
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = FROM_EMAIL
    msg["To"]      = to
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()          
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(FROM_EMAIL, to, msg.as_string())


def send_verification_email(to: str, name: str, token: str) -> None:
    """
    Sends the 'Please verify your email' message with a one-time link.

    The link embeds the raw token as a query param.  When the user clicks it,
    the /auth/verify endpoint looks up that token in the DB, confirms it hasn't
    expired, sets is_verified=True, and deletes the token row.
    """
    link = f"{APP_BASE_URL}/auth/verify?token={token}"
    html = f"""
    <html><body>
      <p>Hi {name},</p>
      <p>Thanks for creating an account. Please verify your email address by
         clicking the link below. This link expires in 24 hours.</p>
      <p><a href="{link}">Verify my email address</a></p>
      <p>If you did not create an account, you can safely ignore this email.</p>
      <hr>
      <p style="color:#888;font-size:12px;">
        If the button doesn't work, copy and paste this URL into your browser:<br>
        {link}
      </p>
    </body></html>
    """
    _send(to, "Verify your email address", html)


def send_password_reset_email(to: str, name: str, token: str) -> None:
    """
    Sends a password-reset link. The link points to the React frontend
    /reset-password page which reads the token from the query string and
    calls POST /auth/reset-password on submit.
    """
    # Frontend runs on port 5173 in dev; use APP_BASE_URL for production.
    frontend_url = APP_BASE_URL.replace(":8000", ":5173")
    link = f"{frontend_url}/reset-password?token={token}"
    html = f"""
    <html><body>
      <p>Hi {name},</p>
      <p>We received a request to reset your password. Click the link below
         (expires in 1 hour):</p>
      <p><a href="{link}">Reset my password</a></p>
      <p>If you didn't request this, ignore this email — your password won't change.</p>
      <hr>
      <p style="color:#888;font-size:12px;">
        If the button doesn't work, copy and paste this URL into your browser:<br>
        {link}
      </p>
    </body></html>
    """
    _send(to, "Reset your password", html)