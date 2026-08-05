/** Metro asset modules — typed so strict TS can import bundled media. */
declare module '*.mp3' {
  const asset: number;
  export default asset;
}
