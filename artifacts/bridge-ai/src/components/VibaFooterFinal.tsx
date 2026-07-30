import { Link } from "wouter";
import { assetUrl, brand } from "@/lib/assets";

const companyEmail = ["support", "viba.guru"].join("@");

export default function VibaFooterFinal() {
  return (
    <footer className="w-full border-t border-white/10 bg-black text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          {/* Standard VIBA logo */}
          <div className="flex items-center">
            <img
              src={assetUrl(brand.vibaLogo)}
              width={brand.vibaLogo.width}
              height={brand.vibaLogo.height}
              alt="VIBA"
              className="h-9 w-auto object-contain"
            />
          </div>

          {/* VIBA logo lockup with tagline beneath */}
          <div className="flex flex-col items-center gap-1.5">
            <img
              src={assetUrl(brand.vibaLogo)}
              width={brand.vibaLogo.width}
              height={brand.vibaLogo.height}
              alt="VIBA"
              className="h-8 w-auto object-contain"
            />
            <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/40">
              All As One
            </span>
          </div>

          {/* Privacy and Terms, kept on the right */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Company email</p>
              <a href={`mailto:${companyEmail}`} className="mt-1 block text-sm text-white/75 hover:text-teal-300">{companyEmail}</a>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Legal</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-white/65">
                <Link href="/privacy" className="hover:text-teal-300">Privacy</Link>
                <Link href="/terms" className="hover:text-teal-300">Terms</Link>
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
