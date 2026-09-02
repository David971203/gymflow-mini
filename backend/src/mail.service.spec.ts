import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('usa la API HTTPS de Mailjet cuando está configurada', async () => {
    const values: Record<string, string> = {
      MAIL_PROVIDER: 'mailjet',
      MAILJET_API_KEY: 'api-key',
      MAILJET_SECRET_KEY: 'secret-key',
      MAILJET_SENDER_EMAIL: 'soporte@example.com',
      MAILJET_SENDER_NAME: 'GymFlow Mini',
    };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ messageId:'message-1' }), { status:201 }));
    const service = new MailService(config);

    await expect(service.sendPasswordResetCode({ to:'owner@example.com', name:'Ana', code:'123456' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://api.mailjet.com/v3.1/send', expect.objectContaining({
      method:'POST',
      headers:expect.objectContaining({authorization:`Basic ${Buffer.from('api-key:secret-key').toString('base64')}`}),
    }));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      Messages:[{
        From:{Name:'GymFlow Mini',Email:'soporte@example.com'},
        To:[{Email:'owner@example.com',Name:'Ana'}],
        Subject:expect.stringContaining('123456'),
      }],
    });
  });

  it('renueva OAuth y envía mediante Gmail API por HTTPS', async () => {
    const values: Record<string, string> = {
      MAIL_PROVIDER: 'gmail_api',
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
      GMAIL_SENDER_EMAIL: 'soporte@gmail.com',
      GMAIL_SENDER_NAME: 'GymFlow Mini',
    };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token:'access-token' }), { status:200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id:'gmail-message-1' }), { status:200 }));
    const service = new MailService(config);

    await expect(service.sendPasswordResetCode({ to:'owner@example.com', name:'Ana', code:'654321' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://oauth2.googleapis.com/token', expect.objectContaining({ method:'POST' }));
    const tokenRequest = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(tokenRequest.body)).toContain('refresh_token=refresh-token');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', expect.objectContaining({
      method:'POST',
      headers:expect.objectContaining({authorization:'Bearer access-token'}),
    }));
    const sendRequest = fetchMock.mock.calls[1][1] as RequestInit;
    const raw = JSON.parse(String(sendRequest.body)).raw as string;
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('From: GymFlow Mini <soporte@gmail.com>');
    expect(mime).toContain('To: owner@example.com');
  });

  it('envía mediante Google Apps Script por HTTPS', async () => {
    const values: Record<string, string> = {
      MAIL_PROVIDER: 'apps_script',
      APPS_SCRIPT_WEB_APP_URL: 'https://script.google.com/macros/s/deployment-id/exec',
      APPS_SCRIPT_SECRET: 'shared-secret',
    };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok:true }), { status:200 }));
    const service = new MailService(config);

    await expect(service.sendPasswordResetCode({ to:'owner@example.com', name:'Ana', code:'987654' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(values.APPS_SCRIPT_WEB_APP_URL, expect.objectContaining({ method:'POST' }));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      secret:'shared-secret',
      to:'owner@example.com',
      name:'Ana',
      subject:expect.stringContaining('987654'),
    });
  });
});
