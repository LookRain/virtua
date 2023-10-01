import type { DeepReadonly, Writeable } from "./types";
import { clamp, median, min } from "./utils";

export const UNCACHED = -1;

export type Cache = DeepReadonly<{
  _defaultItemSize: number;
  _length: number;
  _sizes: number[];
  _measuredOffsetIndex: number;
  _offsets: number[];
}>;

export const getItemSize = (cache: Cache, index: number): number => {
  const size = cache._sizes[index]!;
  return size === UNCACHED ? cache._defaultItemSize : size;
};

export const setItemSize = (
  cache: Writeable<Cache>,
  index: number,
  size: number
): boolean => {
  const isInitialMeasurement = cache._sizes[index] === UNCACHED;
  cache._sizes[index] = size;
  // mark as dirty
  cache._measuredOffsetIndex = min(index, cache._measuredOffsetIndex);
  return isInitialMeasurement;
};

export const computeOffset = (
  cache: Writeable<Cache>,
  index: number
): number => {
  if (!cache._length) return 0;
  if (cache._measuredOffsetIndex >= index) {
    return cache._offsets[index]!;
  }

  let i = cache._measuredOffsetIndex;
  let top = cache._offsets[i]!;
  while (i < index) {
    top += getItemSize(cache, i);
    cache._offsets[++i] = top;
  }
  // mark as measured
  cache._measuredOffsetIndex = index;
  return top;
};

export const computeTotalSize = (cache: Writeable<Cache>): number => {
  if (!cache._length) return 0;
  return (
    computeOffset(cache, cache._length - 1) +
    getItemSize(cache, cache._length - 1)
  );
};

export const findIndex = (
  cache: Cache,
  i: number,
  distance: number
): number => {
  let sum = 0;
  if (distance >= 0) {
    // search forward
    while (i < cache._length - 1) {
      const h = getItemSize(cache, i++);
      if ((sum += h) >= distance) {
        if (sum - h / 2 >= distance) {
          i--;
        }
        break;
      }
    }
  } else {
    // search backward
    while (i > 0) {
      const h = getItemSize(cache, --i);
      if ((sum -= h) <= distance) {
        if (sum + h / 2 < distance) {
          i++;
        }
        break;
      }
    }
  }

  return clamp(i, 0, cache._length - 1);
};

export const findStartIndexWithOffset = (
  cache: Writeable<Cache>,
  offset: number,
  initialIndex: number
): number => {
  return findIndex(
    cache,
    initialIndex,
    offset - computeOffset(cache, initialIndex)
  );
};

export const computeRange = (
  cache: Cache,
  scrollOffset: number,
  prevStartIndex: number,
  viewportSize: number
): [number, number] => {
  const start = findStartIndexWithOffset(
    cache as Writeable<Cache>,
    scrollOffset,
    // Clamp because prevStartIndex may exceed the limit when children decreased a lot after scrolling
    min(prevStartIndex, cache._length - 1)
  );
  return [start, findIndex(cache, start, viewportSize)];
};

export const hasUnmeasuredItemsInRange = (
  cache: Cache,
  startIndex: number,
  endIndex: number
): boolean => {
  return cache._sizes.slice(startIndex, endIndex + 1).includes(UNCACHED);
};

export const estimateDefaultItemSize = (cache: Writeable<Cache>) => {
  const measuredSizes = cache._sizes.filter((s) => s !== UNCACHED);
  // This function will be called after measurement so measured size array must be longer than 0
  const startItemSize = measuredSizes[0]!;

  cache._defaultItemSize = measuredSizes.every((s) => s === startItemSize)
    ? // Maybe a fixed size array
      startItemSize
    : // Maybe a variable size array
      median(measuredSizes);
};

const appendCache = (
  cache: Writeable<Cache>,
  length: number,
  prepend?: boolean
) => {
  const key = prepend ? "unshift" : "push";
  for (let i = cache._length; i < length; i++) {
    cache._sizes[key](UNCACHED);
    // first offset must be 0
    cache._offsets.push(i === 0 ? 0 : UNCACHED);
  }
  cache._length = length;
};

export const initCache = (length: number, itemSize: number): Cache => {
  const cache: Cache = {
    _defaultItemSize: itemSize,
    _length: 0,
    _measuredOffsetIndex: 0,
    _sizes: [],
    _offsets: [],
  };
  appendCache(cache as Writeable<Cache>, length);
  return cache;
};

export const updateCacheLength = (
  cache: Writeable<Cache>,
  length: number,
  isShift?: boolean
): [number, boolean] => {
  const diff = length - cache._length;

  const isRemove = diff < 0;
  let shift: number;
  if (isRemove) {
    // Removed
    shift = (
      isShift ? cache._sizes.splice(0, -diff) : cache._sizes.splice(diff)
    ).reduce(
      (acc, removed) =>
        acc + (removed === UNCACHED ? cache._defaultItemSize : removed),
      0
    );
    cache._offsets.splice(diff);
  } else {
    // Added
    shift = cache._defaultItemSize * diff;
    appendCache(cache, cache._length + diff, isShift);
  }

  cache._measuredOffsetIndex = isShift
    ? // Discard cache for now
      0
    : // measuredOffsetIndex shouldn't be less than 0 because it makes scrollSize NaN and cause infinite rerender.
      // https://github.com/inokawa/virtua/pull/160
      clamp(length - 1, 0, cache._measuredOffsetIndex);
  cache._length = length;
  return [shift, isRemove];
};
