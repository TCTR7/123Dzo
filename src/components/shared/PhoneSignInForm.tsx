'use client';
import { useState, type FormEvent } from 'react';
import { SignIn, useSignIn } from '@clerk/nextjs';
import { usePathname, useRouter } from 'next/navigation';
import { normalizePhoneUsername, PHONE_USERNAME_ERROR } from '@/lib/auth/phone-username';
export function PhoneSignInForm({ returnTo }: { returnTo?: string }) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const pathname = usePathname(), router = useRouter();
  const [phone, setPhone] = useState(''), [password, setPassword] = useState('');
  const [legacy, setLegacy] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const destination = returnTo ? '/?returnTo=' + encodeURIComponent(returnTo) : '/';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isLoaded || busy) return;
    const username = normalizePhoneUsername(phone);
    if (!username) { setError(PHONE_USERNAME_ERROR); return; }
    setBusy(true); setError('');
    try {
      const attempt = await signIn.create({ identifier: username, password, strategy: 'password' });
      if (attempt.status !== 'complete') { setLegacy(true); return; }
      await setActive({ session: attempt.createdSessionId, navigate: async ({ session }) => {
        if (session?.currentTask) setLegacy(true);
        else router.replace(destination);
      } });
    } catch { setError('Chưa đăng nhập được. Kiểm tra số điện thoại và mật khẩu rồi thử lại.'); }
    finally { setBusy(false); }
  }
  if (legacy || !/^\/sign-in\/?$/.test(pathname)) return <SignIn routing="path" path="/sign-in" withSignUp={false} transferable={false} forceRedirectUrl={destination} appearance={{ elements: { footerAction: { display: 'none' } } }} />;
  return <form onSubmit={submit} className="neu-card w-full max-w-sm space-y-5 p-7">
    <h2 className="text-xl font-bold">Chào bạn, đăng nhập nhé</h2>
    <label className="block text-sm font-semibold">Số điện thoại<input id="login-phone" type="tel" inputMode="tel" autoComplete="username" required maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" placeholder="0912345678" /></label>
    <label className="block text-sm font-semibold">Mật khẩu<input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" /></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={!isLoaded || busy} className="min-h-12 w-full rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
    <button type="button" disabled={busy} onClick={() => setLegacy(true)} className="min-h-12 w-full text-sm font-semibold text-teal-800">Đăng nhập bằng Google hoặc tài khoản cũ</button>
  </form>;
}
