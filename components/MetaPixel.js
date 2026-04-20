import Script from 'next/script';

/*
 * Mounts the Meta (Facebook) Pixel base script. Reads the pixel ID
 * from NEXT_PUBLIC_META_PIXEL_ID. Renders nothing if it's not set
 * or if the value isn't a clean numeric ID.
 *
 * Browser-side `fbq('track', 'EventName', {...}, { eventID })` calls
 * are deduplicated by Meta against server-side CAPI events that
 * share the same eventID.
 *
 * Note on dangerouslySetInnerHTML: this is the standard Meta-published
 * install snippet. The only interpolated value is `pixelId`, which is
 * validated below to be digits only — no XSS surface.
 */

export default function MetaPixel() {
  const raw = process.env.NEXT_PUBLIC_META_PIXEL_ID || '';
  if (!/^\d{6,20}$/.test(raw)) return null;
  const pixelId = raw;

  const inline = `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
`;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: inline }} />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
