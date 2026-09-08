import type {} from "remark-parse";
import type { Processor } from "unified";
import type { Construct, State, Token } from "micromark-util-types";
import type { Extension as MarkdownExtension } from "mdast-util-from-markdown";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    studyTexMath: "studyTexMath";
    studyTexMathMarker: "studyTexMathMarker";
    studyTexMathData: "studyTexMathData";
  }
}

type TexToken = Token & { studyDisplay?: boolean };

// Register at Markdown's text-token boundary, before character escapes. Code,
// links, HTML and existing dollar math keep their own parser rules; no global
// string replacement can accidentally rewrite an example or URL.
const texMath: Construct = {
  name: "studyTexMath",
  tokenize(effects, ok, nok) {
    let token: TexToken;
    let opening: number;
    let closing: number;
    let content = false;
    let marker: Token;
    const start: State = (code) => {
      token = effects.enter("studyTexMath");
      effects.enter("studyTexMathMarker");
      effects.consume(code);
      return opener;
    };
    const opener: State = (code) => {
      if (code !== 40 && code !== 91) return nok(code);
      opening = code;
      closing = code === 40 ? 41 : 93;
      token.studyDisplay = code === 91;
      effects.consume(code);
      effects.exit("studyTexMathMarker");
      return inside;
    };
    const inside: State = (code) => {
      if (code === null) return nok(code);
      if (code === -5 || code === -4 || code === -3) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return inside;
      }
      if (code === 92) {
        marker = effects.enter("studyTexMathMarker");
        effects.consume(code);
        return afterBackslash;
      }
      effects.enter("studyTexMathData");
      return data(code);
    };
    const data: State = (code) => {
      if (
        code === null ||
        code === 92 ||
        code === -5 ||
        code === -4 ||
        code === -3
      ) {
        effects.exit("studyTexMathData");
        return inside(code);
      }
      effects.consume(code);
      if (code > 32) content = true;
      return data;
    };
    const afterBackslash: State = (code) => {
      if (code === closing && content) {
        effects.consume(code);
        effects.exit("studyTexMathMarker");
        effects.exit("studyTexMath");
        return ok;
      }
      // Paired backslashes are literal TeX commands/line breaks. A new opener
      // means the previous delimiter was unmatched; do not swallow later math.
      if (code === opening) return nok(code);
      marker.type = "studyTexMathData";
      if (code === 92) {
        effects.consume(code);
        content = true;
        return data;
      }
      content = true;
      return data(code);
    };
    return start;
  },
};

const fromMarkdown: MarkdownExtension = {
  enter: {
    studyTexMath(token: TexToken) {
      this.enter(
        {
          type: "inlineMath",
          value: "",
          data: {
            hName: "code",
            hProperties: {
              className: [
                "language-math",
                token.studyDisplay ? "math-display" : "math-inline",
              ],
            },
            hChildren: [],
          },
        },
        token,
      );
      this.buffer();
    },
  },
  exit: {
    studyTexMathData(token) {
      this.config.enter.data.call(this, token);
      this.config.exit.data.call(this, token);
    },
    studyTexMath(token) {
      const value = this.resume().trim();
      const node = this.stack[this.stack.length - 1];
      this.exit(token);
      if (node.type === "inlineMath") {
        node.value = value;
        node.data!.hChildren = [{ type: "text", value }];
      }
    },
  },
};

export default function remarkTexMath(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ||= []).push({ text: { 92: texMath } });
  (data.fromMarkdownExtensions ||= []).push(fromMarkdown);
}
