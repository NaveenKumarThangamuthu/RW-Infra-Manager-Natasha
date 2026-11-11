import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./tailwind-base.css";
import "./globals.css";
import "./design.css";
import Providers from "@/components/Providers";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Natasha Infra Manager",
  description: "Natasha Infra Manager — unified console for AWS billing, performance, incidents, security findings, and live infrastructure intelligence.",
};

// Applied inline before any React hydration to avoid a flash of the wrong theme or accent.
const THEME_INIT = `
(function(){try{
  var d=document.documentElement;
  var p=localStorage.getItem("natasha-theme")||"dark";
  var t=(p==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p);
  d.setAttribute("data-theme",t); d.style.colorScheme=t;
  var a=localStorage.getItem("natasha-accent");
  if(a) d.setAttribute("data-accent",a);
  var b=localStorage.getItem("natasha-bg");
  if(b&&b!=="default") d.setAttribute("data-bg",b);
  var dn=localStorage.getItem("natasha-density");
  if(dn&&dn!=="comfortable") d.setAttribute("data-density",dn);
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
