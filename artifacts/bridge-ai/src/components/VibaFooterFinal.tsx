import { Link } from "wouter";

const companyEmail = ["support", "viba.guru"].join("@");

export default function VibaFooterFinal() {
  return (
    <footer className="w-full border-t border-white/10 bg-black text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/5 p-1.5">
              <img src="/leego-logo.png" alt="Leego" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Powered by Leego</p>
              <p className="text-xs text-white/45">Technology partner</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Company email</p>
              <a href={`mailto:${companyEmail}`} className="mt-1 block text-sm text-white/75 hover:text-teal-300">{companyEmail}</a>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Legal</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-white/65">
                <Link href="/terms" className="hover:text-teal-300">Terms and Conditions</Link>
                <Link href="/user-instructions" className="hover:text-teal-300">User Instructions</Link>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 pt-5 text-xs text-white/35">© {new Date().getFullYear()} VIBA. All rights reserved.</div>
      </div>
    </footer>
  );
}
