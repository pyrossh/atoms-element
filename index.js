import { html, render as litRender, directive, NodePart, isPrimitive } from './lit-html.js';

const isBrowser = typeof window !== 'undefined';
export { html, isBrowser };

const lastAttributeNameRegex =
  /([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/;
const tagRE = /<[a-zA-Z0-9\-\!\/](?:"[^"]*"|'[^']*'|[^'">])*>/g;
const whitespaceRE = /^\s*$/;
const attrRE = /\s([^'"/\s><]+?)[\s/>]|([^\s=]+)=\s?(".*?"|'.*?')/g;
const voidElements = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
const STRIP_COMMENTS = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|(\s*=[^,\)]*(('(?:\\'|[^'\r\n])*')|("(?:\\"|[^"\r\n])*"))|(\s*=[^,\)]*))/gm;
const ARGUMENT_NAMES = /([^\s,]+)/g;

const parseFuncParams = (func) => {
  const fnStr = func.toString().replace(STRIP_COMMENTS, '');
  const result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
  return (result || []).filter((it) => it !== '{' && it !== '}');
};

const parseTag = (tag) => {
  const res = {
    type: 'tag',
    name: '',
    voidElement: false,
    attrs: {},
    children: [],
  };

  const tagMatch = tag.match(/<\/?([^\s]+?)[/\s>]/);
  if (tagMatch) {
    res.name = tagMatch[1];
    if (voidElements.includes(tagMatch[1]) || tag.charAt(tag.length - 2) === '/') {
      res.voidElement = true;
    }

    // handle comment tag
    if (res.name.startsWith('!--')) {
      const endIndex = tag.indexOf('-->');
      return {
        type: 'comment',
        comment: endIndex !== -1 ? tag.slice(4, endIndex) : '',
      };
    }
  }

  const reg = new RegExp(attrRE);
  let result = null;
  for (;;) {
    result = reg.exec(tag);

    if (result === null) {
      break;
    }

    if (!result[0].trim()) {
      continue;
    }

    if (result[1]) {
      const attr = result[1].trim();
      let arr = [attr, ''];

      if (attr.indexOf('=') > -1) {
        arr = attr.split('=');
      }

      res.attrs[arr[0]] = arr[1];
      reg.lastIndex--;
    } else if (result[2]) {
      res.attrs[result[2]] = result[3].trim().substring(1, result[3].length - 1);
    }
  }

  return res;
};
const parseHtml = (html) => {
  const result = [];
  const arr = [];
  let current;
  let level = -1;

  // handle text at top level
  if (html.indexOf('<') !== 0) {
    var end = html.indexOf('<');
    result.push({
      type: 'text',
      content: end === -1 ? html : html.substring(0, end),
    });
  }

  html.replace(tagRE, function (tag, index) {
    const isOpen = tag.charAt(1) !== '/';
    const isComment = tag.startsWith('<!--');
    const start = index + tag.length;
    const nextChar = html.charAt(start);
    let parent;

    if (isComment) {
      const comment = parseTag(tag);

      // if we're at root, push new base node
      if (level < 0) {
        result.push(comment);
        return result;
      }
      parent = arr[level];
      parent.children.push(comment);
      return result;
    }

    if (isOpen) {
      level++;

      current = parseTag(tag);

      if (!current.voidElement && nextChar && nextChar !== '<') {
        current.children.push({
          type: 'text',
          content: html.slice(start, html.indexOf('<', start)),
        });
      }

      // if we're at root, push new base node
      if (level === 0) {
        result.push(current);
      }

      parent = arr[level - 1];

      if (parent) {
        parent.children.push(current);
      }

      arr[level] = current;
    }

    if (!isOpen || current.voidElement) {
      if (level > -1 && (current.voidElement || current.name === tag.slice(2, -1))) {
        level--;
        // move current up a level to match the end tag
        current = level === -1 ? result : arr[level];
      }
      if (nextChar !== '<' && nextChar) {
        // trailing text node
        // if we're at the root, push a base text node. otherwise add as
        // a child to the current node.
        parent = level === -1 ? result : arr[level].children;

        // calculate correct end of the content slice in case there's
        // no tag after the text node.
        const end = html.indexOf('<', start);
        let content = html.slice(start, end === -1 ? undefined : end);
        // if a node is nothing but whitespace, collapse it as the spec states:
        // https://www.w3.org/TR/html4/struct/text.html#h-9.1
        if (whitespaceRE.test(content)) {
          content = ' ';
        }
        // don't add whitespace-only text nodes if they would be trailing text nodes
        // or if they would be leading whitespace-only text nodes:
        //  * end > -1 indicates this is not a trailing text node
        //  * leading node is when level is -1 and parent has length 0
        if ((end > -1 && level + parent.length >= 0) || content !== ' ') {
          parent.push({
            type: 'text',
            content: content,
          });
        }
      }
    }
  });

  return result;
};

const stringifyAttrs = (attrs) => {
  const buff = [];
  for (let key in attrs) {
    buff.push(key + '="' + attrs[key] + '"');
  }
  if (!buff.length) {
    return '';
  }
  return ' ' + buff.join(' ');
};

const stringifyHtml = (buff, doc) => {
  switch (doc.type) {
    case 'text':
      return buff + doc.content;
    case 'tag':
      buff += '<' + doc.name + (doc.attrs ? stringifyAttrs(doc.attrs) : '') + (doc.voidElement ? '/>' : '>');
      if (doc.voidElement) {
        return buff;
      }
      return buff + doc.children.reduce(stringifyHtml, '') + '</' + doc.name + '>';
    case 'comment':
      buff += '<!--' + doc.comment + '-->';
      return buff;
  }
};

const hydrate = (node) => {
  const Clazz = getElement(node.name);
  if (Clazz) {
    const newAttrs = {};
    Object.keys(node.attrs).forEach((key) => {
      const newValue = node.attrs[key];
      newAttrs[key] = newValue && newValue.startsWith(`{`) ? JSON.parse(newValue.replace(/'/g, `"`)) : newValue;
    });
    const instance = new Clazz(newAttrs);
    const res = instance.render();
    node.children = parseHtml(res);
  }
  if (node.children) {
    for (const child of node.children) {
      hydrate(child);
    }
  }
};

const wrapAttribute = (attrName, suffix, text, v) => {
  let buffer = text;
  const hasQuote = suffix && suffix.includes(`="`);
  if (attrName && !hasQuote) {
    buffer += `"`;
  }
  buffer += v;
  if (attrName && !hasQuote) {
    buffer += `"`;
  }
  return buffer;
};

export const renderHtml = isBrowser
  ? litRender
  : (template) => {
      let js = '';
      template.strings.forEach((text, i) => {
        const value = template.values[i];
        const type = typeof value;
        let attrName, suffix;
        const matchName = lastAttributeNameRegex.exec(text);
        if (matchName) {
          attrName = matchName[2];
          suffix = matchName[3];
        }
        if (value === null || !(type === 'object' || type === 'function' || type === 'undefined')) {
          js += wrapAttribute(attrName, suffix, text, type !== 'string' ? String(value) : value);
        } else if (Array.isArray(value) && value.find((item) => item && item.strings && item.type === 'html')) {
          js += text;
          value.forEach((v) => {
            js += renderHtml(v);
          });
        } else if (type === 'object') {
          // TemplateResult
          if (value.strings && value.type === 'html') {
            js += text;
            js += renderHtml(value);
          } else {
            js += wrapAttribute(attrName, suffix, text, JSON.stringify(value).replace(/"/g, `'`));
          }
        } else if (type == 'function') {
          if (attrName) {
            js += text.replace(' ' + attrName + '=', '');
          } else {
            // js += text;
            // js += value();
          }
        } else if (type !== 'undefined') {
          js += text;
          js += value.toString();
        } else {
          js += text;
          // console.log('value', value);
        }
      });
      const nodes = parseHtml(js);
      for (const node of nodes) {
        hydrate(node);
      }
      const html = nodes.reduce((acc, node) => {
        return acc + stringifyHtml('', node);
      }, '');
      return html;
    };

const hyphenate = (s) => s.replace(/[A-Z]|^ms/g, '-$&').toLowerCase();
const percent = (v) => (v * 100).toFixed(2) + '%';
const createStyle = (...kvs) => {
  const style = {};
  for (let i = 0; i < kvs.length; i += 2) {
    style[hyphenate(kvs[i])] = kvs[i + 1];
  }
  return style;
};

const mapApply = (obj) =>
  Object.keys(obj.keys).reduce((acc, key) => {
    Object.keys(obj.values).map((vkey) => {
      const suffix = vkey ? '-' + vkey : '';
      const className = `${key}${suffix}`;
      if (Array.isArray(obj.keys[key])) {
        const args = [];
        obj.keys[key].forEach((kk) => {
          args.push(kk, obj.values[vkey]);
        });
        acc[className] = createStyle(...args);
      } else {
        acc[className] = createStyle(obj.keys[key], obj.values[vkey]);
      }
    });
    return acc;
  }, {});

export const css = (obj, isChild = false, indent = '') => {
  const cssText = Object.keys(obj).reduce((acc, key) => {
    const value = obj[key];
    acc += !isChild ? `${key} {\n` : '';
    if (typeof value === 'object') {
      acc += '\n' + css(value, true, indent + '  ');
    } else {
      acc += '  ' + indent + hyphenate(key) + ': ' + value + ';\n';
    }
    acc += !isChild ? `\n}\n` : '';
    return acc;
  }, '');
  return cssText;
};

const extractClasses = (html) => {
  let str = '';
  const matches = html.match(/class=(?:["']\W+\s*(?:\w+)\()?["']([^'"]+)['"]/gim);
  if (matches) {
    matches.forEach((matched, i) => {
      str += matched.replace('class="', '').replace('"', '') + (i === matches.length - 1 ? '' : ' ');
    });
  }
  return str;
};

const getClassList = (template) => {
  // need to have this incase of shadowDom
  // const classes = template.strings.reduce((acc, item) => acc + extractClasses(item), '').split(' ');
  const classes = [];
  template.values.forEach((item) => {
    if (typeof item === 'string') {
      const list = item.split(' ');
      return classes.push(...list.filter((cls) => classLookup[cls]));
    }
    return false;
  });
  return classes;
};

export const compileTw = (classList) => {
  let styleSheet = ``;
  classList.forEach((cls) => {
    const item = classLookup[cls];
    if (item) {
      const className = cls.replace(`/`, `\\/`);
      styleSheet += `
        .${className} {
          ${Object.keys(item)
            .map((key) => `${key}: ${item[key]};`)
            .join('\n')}
        }
      `;
    }
  });
  return styleSheet;
};

const colors = {
  keys: {
    bg: 'backgroundColor',
    text: 'color',
    divide: 'borderColor',
    border: 'borderColor',
    ring: '--tw-ring-color',
    'border-l': 'borderLeftColor',
    'border-r': 'borderRightColor',
    'border-t': 'borderTopColor',
    'border-b': 'borderBottomColor',
  },
  values: {
    transparent: 'transparent',
    current: 'currentColor',
    black: 'rgba(0, 0, 0, 1)',
    white: 'rgba(255, 255, 255, 1)',
    'gray-50': 'rgba(249, 250, 251, 1)',
    'gray-100': 'rgba(243, 244, 246, 1)',
    'gray-200': 'rgba(229, 231, 235, 1)',
    'gray-300': 'rgba(209, 213, 219, 1)',
    'gray-400': 'rgba(156, 163, 175, 1)',
    'gray-500': 'rgba(107, 114, 128, 1)',
    'gray-600': 'rgba(75, 85, 99, 1)',
    'gray-700': 'rgba(55, 65, 81, 1)',
    'gray-800': 'rgba(31, 41, 55, 1)',
    'gray-900': 'rgba(17, 24, 39, 1)',
    'red-50': 'rgba(254, 242, 242, 1)',
    'red-100': 'rgba(254, 226, 226, 1)',
    'red-200': 'rgba(254, 202, 202, 1)',
    'red-300': 'rgba(252, 165, 165, 1)',
    'red-400': 'rgba(248, 113, 113, 1)',
    'red-500': 'rgba(239, 68, 68, 1)',
    'red-600': 'rgba(220, 38, 38, 1)',
    'red-700': 'rgba(185, 28, 28, 1)',
    'red-800': 'rgba(153, 27, 27, 1)',
    'red-900': 'rgba(127, 29, 29, 1)',
    'yellow-50': 'rgba(255, 251, 235, 1)',
    'yellow-100': 'rgba(254, 243, 199, 1)',
    'yellow-200': 'rgba(253, 230, 138, 1)',
    'yellow-300': 'rgba(252, 211, 77, 1)',
    'yellow-400': 'rgba(251, 191, 36, 1)',
    'yellow-500': 'rgba(245, 158, 11, 1)',
    'yellow-600': 'rgba(217, 119, 6, 1)',
    'yellow-700': 'rgba(180, 83, 9, 1)',
    'yellow-800': 'rgba(146, 64, 14, 1)',
    'yellow-900': 'rgba(120, 53, 15, 1)',
    'green-50': 'rgba(236, 253, 245, 1)',
    'green-100': 'rgba(209, 250, 229, 1)',
    'green-200': 'rgba(167, 243, 208, 1)',
    'green-300': 'rgba(110, 231, 183, 1)',
    'green-400': 'rgba(52, 211, 153, 1)',
    'green-500': 'rgba(16, 185, 129, 1)',
    'green-600': 'rgba(5, 150, 105, 1)',
    'green-700': 'rgba(4, 120, 87, 1)',
    'green-800': 'rgba(6, 95, 70, 1)',
    'green-900': 'rgba(6, 78, 59, 1)',
    'blue-50': 'rgba(239, 246, 255, 1)',
    'blue-100': 'rgba(219, 234, 254, 1)',
    'blue-200': 'rgba(191, 219, 254, 1)',
    'blue-300': 'rgba(147, 197, 253, 1)',
    'blue-400': 'rgba(96, 165, 250, 1)',
    'blue-500': 'rgba(59, 130, 246, 1)',
    'blue-600': 'rgba(37, 99, 235, 1)',
    'blue-700': 'rgba(29, 78, 216, 1)',
    'blue-800': 'rgba(30, 64, 175, 1)',
    'blue-900': 'rgba(30, 58, 138, 1)',
    'indigo-50': 'rgba(238, 242, 255, 1)',
    'indigo-100': 'rgba(224, 231, 255, 1)',
    'indigo-200': 'rgba(199, 210, 254, 1)',
    'indigo-300': 'rgba(165, 180, 252, 1)',
    'indigo-400': 'rgba(129, 140, 248, 1)',
    'indigo-500': 'rgba(99, 102, 241, 1)',
    'indigo-600': 'rgba(79, 70, 229, 1)',
    'indigo-700': 'rgba(67, 56, 202, 1)',
    'indigo-800': 'rgba(55, 48, 163, 1)',
    'indigo-900': 'rgba(49, 46, 129, 1)',
    'purple-50': 'rgba(245, 243, 255, 1)',
    'purple-100': 'rgba(237, 233, 254, 1)',
    'purple-200': 'rgba(221, 214, 254, 1)',
    'purple-300': 'rgba(196, 181, 253, 1)',
    'purple-400': 'rgba(167, 139, 250, 1)',
    'purple-500': 'rgba(139, 92, 246, 1)',
    'purple-600': 'rgba(124, 58, 237, 1)',
    'purple-700': 'rgba(109, 40, 217, 1)',
    'purple-800': 'rgba(91, 33, 182, 1)',
    'purple-900': 'rgba(76, 29, 149, 1)',
    'pink-50': 'rgba(253, 242, 248, 1)',
    'pink-100': 'rgba(252, 231, 243, 1)',
    'pink-200': 'rgba(251, 207, 232, 1)',
    'pink-300': 'rgba(249, 168, 212, 1)',
    'pink-400': 'rgba(244, 114, 182, 1)',
    'pink-500': 'rgba(236, 72, 153, 1)',
    'pink-600': 'rgba(219, 39, 119, 1)',
    'pink-700': 'rgba(190, 24, 93, 1)',
    'pink-800': 'rgba(157, 23, 77, 1)',
    'pink-900': 'rgba(131, 24, 67, 1)',
  },
};

const spacing = {
  keys: {
    mr: 'marginRight',
    ml: 'marginLeft',
    mt: 'marginTop',
    mb: 'marginBottom',
    mx: ['marginLeft', 'marginRight'],
    my: ['marginTop', 'marginBottom'],
    m: 'margin',
    pr: 'paddingRight',
    pl: 'paddingLeft',
    pt: 'paddingTop',
    pb: 'paddingBottom',
    px: ['paddingLeft', 'paddingRight'],
    py: ['paddingTop', 'paddingBottom'],
    p: 'padding',
  },
  values: {
    auto: 'auto',
    0: '0px',
    px: '1px',
    0.5: '0.125rem',
    1: '0.25rem',
    1.5: '0.375rem',
    2: '0.5rem',
    2.5: '0.625rem',
    3: '0.75rem',
    3.5: '0.875rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    7: '1.75rem',
    8: '2rem',
    9: '2.25rem',
    10: '2.5rem',
    11: '2.75rem',
    12: '3rem',
    14: '3.5rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
    28: '7rem',
    32: '8rem',
    36: '9rem',
    40: '10rem',
    44: '11rem',
    48: '12rem',
    52: '13rem',
    56: '14rem',
    60: '15rem',
    64: '16rem',
    72: '18rem',
    80: '20rem',
    96: '24rem',
  },
};

const radius = {
  keys: {
    rounded: 'borderRadius',
    'rounded-t': 'borderTopRadius',
    'rounded-r': 'borderRightRadius',
    'rounded-l': 'borderLeftRadius',
    'rounded-b': 'borderBottomRadius',
    'rounded-tl': ['borderTopRadius', 'borderLeftRadius'],
    'rounded-tr': ['borderTopRadius', 'borderRightRadius'],
    'rounded-bl': ['borderBottomRadius', 'borderLeftRadius'],
    'rounded-br': ['borderBottomRadius', 'borderRightRadius'],
  },
  values: {
    none: '0px',
    sm: '0.125rem',
    '': '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    '3xl': '1.5rem',
    full: '9999px',
  },
};

const borders = {
  keys: {
    border: 'borderWidth',
    'border-l': 'borderLeftWidth',
    'border-r': 'borderRightWidth',
    'border-t': 'borderTopWidth',
    'border-b': 'borderBottomWidth',
  },
  values: {
    '': '1px',
    0: '0px',
    2: '2px',
    4: '4px',
    8: '8px',
  },
};

const sizes = {
  keys: {
    h: 'height',
    w: 'width',
    top: 'top',
    left: 'left',
    bottom: 'bottom',
    right: 'right',
    minh: 'minHeight',
    minw: 'minWidth',
    maxh: 'maxHeight',
    maxw: 'maxWidth',
  },
  values: {
    0: '0px',
    px: '1px',
    0.5: '0.125rem',
    1: '0.25rem',
    1.5: '0.375rem',
    2: '0.5rem',
    2.5: '0.625rem',
    3: '0.75rem',
    3.5: '0.875rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    7: '1.75rem',
    8: '2rem',
    9: '2.25rem',
    10: '2.5rem',
    11: '2.75rem',
    12: '3rem',
    14: '3.5rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
    28: '7rem',
    32: '8rem',
    36: '9rem',
    40: '10rem',
    44: '11rem',
    48: '12rem',
    52: '13rem',
    56: '14rem',
    60: '15rem',
    64: '16rem',
    72: '18rem',
    80: '20rem',
    96: '24rem',
    auto: 'auto',
    min: 'min-content',
    max: 'max-content',
    '1/2': percent(1 / 2),
    '1/4': percent(1 / 4),
    '2/4': percent(2 / 4),
    '3/4': percent(3 / 4),
    '1/5': percent(1 / 5),
    '2/5': percent(2 / 5),
    '3/5': percent(3 / 5),
    '4/5': percent(4 / 5),
    '1/6': percent(1 / 6),
    '2/6': percent(2 / 6),
    '3/6': percent(3 / 6),
    '4/6': percent(4 / 6),
    '5/6': percent(5 / 6),
    '1/12': percent(1 / 12),
    '2/12': percent(2 / 12),
    '3/12': percent(3 / 12),
    '4/12': percent(4 / 12),
    '5/12': percent(5 / 12),
    '6/12': percent(6 / 12),
    '7/12': percent(7 / 12),
    '8/12': percent(8 / 12),
    '9/12': percent(9 / 12),
    '10/12': percent(10 / 12),
    '11/12': percent(11 / 12),
    full: percent(1),
  },
};

const classLookup = {
  flex: createStyle('display', 'flex'),
  'inline-flex': createStyle('display', 'inline-flex'),
  block: createStyle('display', 'block'),
  'inline-block': createStyle('display', 'inline-block'),
  inline: createStyle('display', 'inline'),
  table: createStyle('display', 'table'),
  'inline-table': createStyle('display', 'inline-table'),
  'inline-table': createStyle('display', 'inline-table'),
  grid: createStyle('display', 'grid'),
  'inline-grid': createStyle('display', 'inline-grid'),
  contents: createStyle('display', 'contents'),
  'list-item': createStyle('display', 'list-item'),
  hidden: createStyle('display', 'none'),
  'flex-1': createStyle('flex', '1'),
  'flex-row': createStyle('flexDirection', 'row'),
  'flex-col': createStyle('flexDirection', 'column'),
  'flex-wrap': createStyle('flexWrap', 'wrap'),
  'flex-nowrap': createStyle('flexWrap', 'nowrap'),
  'flex-wrap-reverse': createStyle('flexWrap', 'wrap-reverse'),
  'items-baseline': createStyle('alignItems', 'baseline'),
  'items-start': createStyle('alignItems', 'flex-start'),
  'items-center': createStyle('alignItems', 'center'),
  'items-end': createStyle('alignItems', 'flex-end'),
  'items-stretch': createStyle('alignItems', 'stretch'),
  'justify-start': createStyle('justifyContent', 'flex-start'),
  'justify-end': createStyle('justifyContent', 'flex-end'),
  'justify-center': createStyle('justifyContent', 'center'),
  'justify-between': createStyle('justifyContent', 'space-between'),
  'justify-around': createStyle('justifyContent', 'space-around'),
  'justify-evenly': createStyle('justifyContent', 'space-evenly'),
  'text-left': createStyle('textAlign', 'left'),
  'text-center': createStyle('textAlign', 'center'),
  'text-right': createStyle('textAlign', 'right'),
  'text-justify': createStyle('textAlign', 'justify'),
  underline: createStyle('textDecoration', 'underline'),
  'line-through': createStyle('textDecoration', 'line-through'),
  'no-underline': createStyle('textDecoration', 'none'),
  'whitespace-normal': createStyle('whiteSpace', 'normal'),
  'whitespace-nowrap': createStyle('whiteSpace', 'nowrap'),
  'whitespace-pre': createStyle('whiteSpace', 'pre'),
  'whitespace-pre-line': createStyle('whiteSpace', 'pre-line'),
  'whitespace-pre-wrap': createStyle('whiteSpace', 'pre-wrap'),
  'break-normal': createStyle('wordBreak', 'normal', 'overflowWrap', 'normal'),
  'break-words': createStyle('wordBreak', 'break-word'),
  'break-all': createStyle('wordBreak', 'break-all'),
  'font-sans': createStyle(
    'fontFamily',
    `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`,
  ),
  'font-serif': createStyle('fontFamily', `ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`),
  'font-mono': createStyle('fontFamily', `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`),
  'font-thin': createStyle('fontWeight', '100'),
  'font-extralight': createStyle('fontWeight', '200'),
  'font-light': createStyle('fontWeight', '300'),
  'font-normal': createStyle('fontWeight', '400'),
  'font-medium': createStyle('fontWeight', '500'),
  'font-semibold': createStyle('fontWeight', '600'),
  'font-bold': createStyle('fontWeight', '700'),
  'font-extrabold': createStyle('fontWeight', '800'),
  'font-black': createStyle('fontWeight', '900'),
  'text-xs': createStyle('fontSize', '0.75rem', 'lineHeight', '1rem'),
  'text-sm': createStyle('fontSize', '0.875rem', 'lineHeight', '1.25rem'),
  'text-base': createStyle('fontSize', '1rem', 'lineHeight', '1.5rem'),
  'text-lg': createStyle('fontSize', '1.125rem', 'lineHeight', '1.75rem'),
  'text-xl': createStyle('fontSize', '1.25rem', 'lineHeight', '1.75rem'),
  'text-2xl': createStyle('fontSize', '1.5rem', 'lineHeight', '2rem'),
  'text-3xl': createStyle('fontSize', '1.875rem', 'lineHeight', '2.25rem'),
  'text-4xl': createStyle('fontSize', '2.25rem', 'lineHeight', '2.5rem'),
  'text-5xl': createStyle('fontSize', '3rem', 'lineHeight', '1'),
  'text-6xl': createStyle('fontSize', '3.75rem;', 'lineHeight', '1'),
  'text-7xl': createStyle('fontSize', '4.5rem', 'lineHeight', '1'),
  'text-8xl': createStyle('fontSize', '6rem', 'lineHeight', '1'),
  'text-9xl': createStyle('fontSize', '8rem', 'lineHeight', '1'),
  'cursor-auto': createStyle('cursor', 'auto'),
  'cursor-default': createStyle('cursor', 'default'),
  'cursor-pointer': createStyle('cursor', 'pointer'),
  'cursor-wait': createStyle('cursor', 'wait'),
  'cursor-text': createStyle('cursor', 'text'),
  'cursor-move': createStyle('cursor', 'move'),
  'cursor-help': createStyle('cursor', 'help'),
  'cursor-not-allowed': createStyle('cursor', 'not-allowed'),
  'pointer-events-none': createStyle('pointerEvents', 'none'),
  'pointer-events-auto': createStyle('pointerEvents', 'auto'),
  'select-none': createStyle('userSelect', 'none'),
  'select-text': createStyle('userSelect', 'text'),
  'select-all': createStyle('userSelect', 'all'),
  'select-auto': createStyle('userSelect', 'auto'),
  'w-screen': '100vw',
  'h-screen': '100vh',
  ...mapApply(sizes),
  ...mapApply(spacing),
  ...mapApply(colors),
  ...mapApply(borders),
  ...mapApply(radius),
  static: createStyle('position', 'static'),
  fixed: createStyle('position', 'fixed'),
  absolute: createStyle('position', 'absolute'),
  relative: createStyle('position', 'relative'),
  sticky: createStyle('position', 'sticky'),
  'overflow-auto': createStyle('overflow', 'auto'),
  'overflow-hidden': createStyle('overflow', 'hidden'),
  'overflow-visible': createStyle('overflow', 'visible'),
  'overflow-scroll': createStyle('overflow', 'scroll'),
  'overflow-x-auto': createStyle('overflowX', 'auto'),
  'overflow-y-auto': createStyle('overflowY', 'auto'),
  'overflow-x-hidden': createStyle('overflowX', 'hidden'),
  'overflow-y-hidden': createStyle('overflowY', 'hidden'),
  'overflow-x-visible': createStyle('overflowX', 'visible'),
  'overflow-y-visible': createStyle('overflowY', 'visible'),
  'overflow-x-scroll': createStyle('overflowX', 'scroll'),
  'overflow-y-scroll': createStyle('overflowY', 'scroll'),
  'origin-center': createStyle('transformOrigin', 'center'),
  'origin-top': createStyle('transformOrigin', 'top'),
  'origin-top-right': createStyle('transformOrigin', 'top right'),
  'origin-right': createStyle('transformOrigin', 'right'),
  'origin-bottom-right': createStyle('transformOrigin', 'bottom right'),
  'origin-bottom': createStyle('transformOrigin', 'bottom'),
  'origin-bottom-left': createStyle('transformOrigin', 'bottom left'),
  'origin-left': createStyle('transformOrigin', 'left'),
  'origin-top-left': createStyle('transformOrigin', 'top left'),
  'shadow-sm': createStyle('box-shadow', '0 0 #0000, 0 0 #0000, 0 1px 2px 0 rgba(0, 0, 0, 0.05)'),
  shadow: createStyle('box-shadow', '0 0 #0000, 0 0 #0000, 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'),
  'shadow-md': createStyle('box-shadow', '0 0 #0000, 0 0 #0000, 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'),
  'shadow-lg': createStyle('box-shadow', '0 0 #0000, 0 0 #0000, 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'),
  'shadow-xl': createStyle('box-shadow', '0 0 #0000, 0 0 #0000, 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'),
  'shadow-2xl': createStyle('box-shadow', '0 0 #0000, 0 0 #0000, 0 25px 50px -12px rgba(0, 0, 0, 0.25)'),
  'shadow-inner': createStyle('box-shadow', '0 0 #0000, 0 0 #0000, inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'),
  'shadow-none': createStyle('box-shadow', '0 0 #0000, 0 0 #0000, 0 0 #0000'),
  'ring-inset': createStyle('--tw-ring-inset', 'insest'),
  'ring-0': createStyle('box-shadow', ' 0 0 0 calc(0px + 0px) rgba(59, 130, 246, 0.5)'),
  'ring-1': createStyle('box-shadow', ' 0 0 0 calc(1px + 0px) rgba(59, 130, 246, 0.5)'),
  'ring-2': createStyle('box-shadow', ' 0 0 0 calc(2px + 0px) rgba(59, 130, 246, 0.5)'),
  'ring-4': createStyle('box-shadow', ' 0 0 0 calc(4px + 0px) rgba(59, 130, 246, 0.5)'),
  'ring-8': createStyle('box-shadow', ' 0 0 0 calc(8px + 0px) rgba(59, 130, 246, 0.5)'),
  ring: createStyle('box-shadow', ' 0 0 0 calc(3px + 0px) rgba(59, 130, 246, 0.5)'),
};

const pageStyles = {
  '*, ::before, ::after': {
    boxSizing: 'border-box',
    borderWidth: '0',
    borderStyle: 'solid',
    borderColor: '#e5e7eb',
  },
  hr: { height: '0', color: 'inherit', borderTopWidth: '1px' },
  'abbr[title]': {
    WebkitTextDecoration: 'underline dotted',
    textDecoration: 'underline dotted',
  },
  'b, strong': { fontWeight: 'bolder' },
  'code, kbd, samp, pre': {
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
    fontSize: '1em',
  },
  small: { fontSize: '80%' },
  'sub, sup': {
    fontSize: '75%',
    lineHeight: 0,
    position: 'relative',
    verticalAlign: 'baseline',
  },
  sub: { bottom: '-0.25em' },
  sup: { top: '-0.5em' },
  table: {
    textIndent: '0',
    borderColor: 'inherit',
    borderCollapse: 'collapse',
  },
  'button, input, optgroup, select, textarea': {
    fontSize: '100%',
    margin: '0',
    padding: '0',
    lineHeight: 'inherit',
    color: 'inherit',
  },
  'button, select': {},
  "button, [type='button'], [type='reset'], [type='submit']": {},
  '::-moz-focus-inner': { borderStyle: 'none', padding: '0' },
  ':-moz-focusring': { outline: '1px dotted ButtonText' },
  ':-moz-ui-invalid': { boxShadow: 'none' },
  legend: { padding: '0' },
  progress: { verticalAlign: 'baseline' },
  '::-webkit-inner-spin-button, ::-webkit-outer-spin-button': {
    height: 'auto',
  },
  "[type='search']": { WebkitAppearance: 'textfield', outlineOffset: '-2px' },
  '::-webkit-search-decoration': { WebkitAppearance: 'none' },
  '::-webkit-file-upload-button': {
    WebkitAppearance: 'button',
    font: 'inherit',
  },
  summary: { display: 'list-item' },
  'blockquote, dl, dd, h1, h2, h3, h4, h5, h6, hr, figure, p, pre': {
    margin: '0',
  },
  button: {
    backgroundImage: 'none',
    ':focus': {
      outline: '1px dotted, 5px auto -webkit-focus-ring-color',
    },
  },
  fieldset: { margin: '0', padding: '0' },
  'ol, ul': { listStyle: 'none', margin: '0', padding: '0' },
  img: { borderStyle: 'solid' },
  textarea: { resize: 'vertical' },
  'input::-moz-placeholder, textarea::-moz-placeholder': {
    opacity: 1,
    color: '#9ca3af',
  },
  'input:-ms-input-placeholder, textarea:-ms-input-placeholder': {
    opacity: 1,
    color: '#9ca3af',
  },
  'input::placeholder, textarea::placeholder': {
    opacity: 1,
    color: '#9ca3af',
  },
  "button, [role='button']": { cursor: 'pointer' },
  'h1, h2, h3, h4, h5, h6': { fontSize: 'inherit', fontWeight: 'inherit' },
  a: { color: 'inherit', textDecoration: 'inherit' },
  'pre, code, kbd, samp': {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
  'img, svg, video, canvas, audio, iframe, embed, object': {
    display: 'block',
    verticalAlign: 'middle',
  },
  'img, video': { maxWidth: '100%', height: 'auto' },
  html: {
    MozTabSize: '4',
    OTabSize: '4',
    tabSize: 4,
    lineHeight: 1.5,
    WebkitTextSizeAdjust: '100%',
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
    width: '100%',
    height: '100%',
  },
  body: {
    margin: '0px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    lineHeight: 1.4,
    backgroundColor: 'white',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 0%',
    minWidth: '320px',
    minHeight: '100vh',
    fontWeight: 400,
    color: 'rgba(44, 62, 80, 1)',
    direction: 'ltr',
    fontSynthesis: 'none',
    textRendering: 'optimizeLegibility',
  },
};

// hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 focus:ring-indigo-500

const previousValues = new WeakMap();
export const unsafeHTML = isBrowser
  ? directive((value) => (part) => {
      if (!(part instanceof NodePart)) {
        throw new Error('unsafeHTML can only be used in text bindings');
      }
      const previousValue = previousValues.get(part);
      if (previousValue !== undefined && isPrimitive(value) && value === previousValue.value && part.value === previousValue.fragment) {
        return;
      }
      const template = document.createElement('template');
      template.innerHTML = value; // innerHTML casts to string internally
      const fragment = document.importNode(template.content, true);
      part.setValue(fragment);
      previousValues.set(part, { value, fragment });
    })
  : (value) => value;

const fifo = (q) => q.shift();
const filo = (q) => q.pop();
const microtask = (flush) => () => queueMicrotask(flush);
const task = (flush) => {
  if (isBrowser) {
    const ch = new window.MessageChannel();
    ch.port1.onmessage = flush;
    return () => ch.port2.postMessage(null);
  } else {
    return () => setImmediate(flush);
  }
};
const depsChanged = (prev, next) => prev == null || next.some((f, i) => !Object.is(f, prev[i]));

export const createAttrs = (attrs) => attrs;

export const createReducer = ({ initial, reducer, effects }) => {
  let value = initial;
  const subs = new Set();
  const actions = Object.keys(reducer).reduce((acc, key) => {
    const reduce = reducer[key];
    acc[key] = (v) => {
      value = reduce(value, v);
      subs.forEach((sub) => {
        sub(value);
      });
    };
    return acc;
  }, {});
  const effectActions = Object.keys(effects || {}).reduce((acc, key) => {
    const effect = effects[key];
    acc[key] = (v) => effect(actions, v);
    return acc;
  }, {});
  return {
    getValue: () => value,
    subscribe: (fn) => {
      subs.add(fn);
    },
    unsubscribe: (fn) => {
      subs.remove(fn);
    },
    actions,
    effects: effectActions,
  };
};

const currentComponent = {
  current: undefined,
  set(v) {
    this.current = v;
    this.current.hooks.index = 0;
  },
  get() {
    return this.current;
  },
};

export const useReducer = (reducer) => {
  const comp = currentComponent.get();
  const index = comp.hooks.index++;
  if (!comp.hooks.data[index]) {
    comp.hooks.data[index] = reducer.subscribe ? reducer : createReducer(reducer);
    comp.hooks.data[index].subscribe(() => comp.update());
  }
  const state = comp.hooks.data[index].getValue();
  return { ...state, actions: comp.hooks.data[index].actions, effects: comp.hooks.data[index].effects };
};
export const useEffect = (fn, deps) => {
  const comp = currentComponent.get();
  const index = comp.hooks.index++;
  if (!deps || depsChanged(comp.hooks.deps[index], deps)) {
    comp.hooks.deps[index] = deps || [];
    comp.hooks.effects[index] = fn;
  }
};

const registry = {};
export const getElement = (name) => registry[name];
const BaseElement = isBrowser ? window.HTMLElement : class {};
export const createElement = (meta, renderFn) => {
  const funcParams = parseFuncParams(renderFn);
  const RenderElement = class extends BaseElement {
    static get observedAttributes() {
      return funcParams.map((k) => k.toLowerCase());
    }

    constructor(ssrAttrs) {
      super();
      this._dirty = false;
      this._connected = false;
      this.attrs = ssrAttrs || {};
      this.state = {};
      this.hooks = {
        index: 0,
        data: {},
        deps: {},
        effects: {},
        cleanups: {},
      };
      this.renderFn = renderFn;
      // this.prevClassList = [];
      // this.shadow = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
      this._connected = true;
      this.update();
    }

    disconnectedCallback() {
      this._connected = false;
    }

    attributeChangedCallback(key, oldValue, newValue) {
      this.attrs[key] = newValue && newValue.startsWith(`{`) ? JSON.parse(newValue.replace(/'/g, `"`)) : newValue;
      if (this._connected) {
        this.update();
      }
    }

    update() {
      if (this._dirty) {
        return;
      }
      this._dirty = true;
      this.enqueueUpdate();
    }

    _performUpdate() {
      if (!this._connected) {
        return;
      }
      this.render();
      this.enqueueEffects();
      this._dirty = false;
    }

    _flushEffects() {
      const effects = this.hooks.effects;
      const cleanups = this.hooks.cleanups;
      const keys = Object.keys(effects);
      for (const key of keys) {
        if (effects[key]) {
          cleanups[key] && cleanups[key]();
          const cleanup = effects[key]();
          if (cleanup) {
            cleanups[key] = cleanup;
          }
          delete effects[key];
        }
      }
    }

    batch(runner, pick, callback) {
      const q = [];
      const flush = () => {
        let p;
        while ((p = pick(q))) callback(p);
      };
      const run = runner(flush);
      q.push(this) === 1 && run();
    }

    enqueueUpdate() {
      this.batch(microtask, fifo, () => this._performUpdate());
    }

    enqueueEffects() {
      this.batch(task, filo, () => this._flushEffects());
    }

    render() {
      currentComponent.set(this);
      const template = this.renderFn({
        ...this.attrs,
        config: isBrowser ? window.props.config : global?.props?.config,
        location: isBrowser ? window.location : global?.location,
      });
      if (isBrowser) {
        // TODO: this can be optimized when we know whether the value belongs in a class (AttributePart)
        // maybe do this in lit-html itselfs
        const newClassList = getClassList(template).filter((cls) => {
          const globalStyles = document.getElementById('global').textContent;
          return !globalStyles.includes('.' + cls);
        });
        if (newClassList.length > 0) {
          document.getElementById('global').textContent += compileTw(newClassList);
        }
        renderHtml(template, this);
        // For shadows only
        // if (!this.styleElement) {
        //   render(template, this.shadow);
        //   const styleSheet = compileTw(classList);
        //   this.prevClassList = classList;
        //   this.styleElement = document.createElement('style');
        //   this.shadow.appendChild(this.styleElement).textContent = css(pageStyles) + styleSheet;
        // } else {
        //   const missingClassList = classList.filter((cls) => !this.prevClassList.includes(cls));
        //   if (missingClassList.length > 0) {
        //     const styleSheet = compileTw(missingClassList);
        //     this.styleElement.textContent += '\n' + styleSheet;
        //     this.prevClassList.push(...missingClassList);
        //   }
        //   render(template, this.shadow);
        // }
      } else {
        return renderHtml(template);
      }
    }
  };
  const parts = meta.url.split('/');
  const name = parts[parts.length - 1].split('?')[0].replace('.js', '');
  registry[name] = RenderElement;
  if (isBrowser && !window.customElements.get(name)) {
    window.customElements.define(name, registry[name]);
  }
  return renderFn;
};

export const createPage = ({ head, body }) => {
  return ({ headScript, bodyScript, lang, props }) => {
    const headHtml = renderHtml(head(props));
    const bodyHtml = renderHtml(body(props));
    const classes = extractClasses(bodyHtml);
    return `
      <!DOCTYPE html>
      <html lang="${lang}">
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="x-ua-compatible" content="ie=edge" />
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5.0, shrink-to-fit=no">
          <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
          <link rel="icon" type="image/png" href="/assets/icon.png" />
          ${headHtml}
          <style id="global">
            ${css(pageStyles)}
            ${compileTw(new Set(classes.split(' ')))}
          </style>
          ${headScript}
        </head>
        <body>
          ${bodyHtml}
          <script>
            window.props = ${JSON.stringify(props)};
          </script>
          ${bodyScript}
        </body>
      </html>
  `;
  };
};
