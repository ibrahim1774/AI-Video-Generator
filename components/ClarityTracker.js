import Script from 'next/script';

/*
 * Mounts Microsoft Clarity's tracking script. Project ID is hardcoded;
 * change CLARITY_PROJECT_ID if you rotate it. Validated to be
 * [a-z0-9] only so the interpolation into the inline bootstrap is safe.
 */

export const CLARITY_PROJECT_ID = 'w5jdq6huun';

export default function ClarityTracker() {
  if (!/^[a-z0-9]+$/i.test(CLARITY_PROJECT_ID)) return null;

  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
    </Script>
  );
}
