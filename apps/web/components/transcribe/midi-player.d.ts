/**
 * html-midi-player registers the <midi-player> custom element at import time.
 * Declare it for TSX so strict mode accepts the tag.
 */

declare module 'html-midi-player';

declare namespace React.JSX {
  interface IntrinsicElements {
    'midi-player': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string;
        'sound-font'?: string;
      },
      HTMLElement
    >;
  }
}
