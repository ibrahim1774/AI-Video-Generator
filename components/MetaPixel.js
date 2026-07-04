import Script from 'next/script';

/*
 * Mounts the Meta (Facebook) Pixel base script.
 *
 * Pixel ID is hardcoded below. If you ever need to change it, update
 * META_PIXEL_ID here AND the same constant in lib/meta.js so client
 * Pixel events and server CAPI events target the same pixel.
 *
 * Browser-side `fbq('track', 'EventName', {...}, { eventID })` calls
 * are deduplicated by Meta against server-side CAPI events that
 * share the same eventID.
 */

export const META_PIXEL_ID = '26490568997297314';

// This deployment's product id. The pixel above is SHARED across several
// products (ariyalab, primehub, aibarber, primevoiceai, ...), so every browser
// conversion event is stamped with `product` — matching the server CAPI
// custom_data (lib/meta.js META_PRODUCT) — so a Custom Conversion
// (Purchase where product = ariyalab) can count ONLY this product's sales and
// exclude the other sites' events. Keep in sync with lib/meta.js.
export const META_PRODUCT = 'ariyalab';

export default function MetaPixel() {
  const inline = `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
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
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
