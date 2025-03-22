// 扩展 chrome 和 Location 的类型定义

// 扩展 Location 类型
interface Location {
  readonly ancestorOrigins: DOMStringList;
}

// 扩展 DOMStringList 类型
interface DOMStringList {
  [Symbol.iterator](): IterableIterator<string>;
}