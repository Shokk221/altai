/// <reference types="react" />
/// <reference types="react-dom" />
/// <reference types="next" />
/// <reference types="next/image-types/global" />

declare global {
  namespace JSX {
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
