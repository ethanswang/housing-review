/** Skeleton for a property page: title, rating summary, key facts, reviews. */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-6xl px-4 pt-2 md:px-6 md:pt-6 lg:grid lg:grid-cols-[minmax(0,42rem)_20rem] lg:justify-between lg:gap-x-12"
      aria-busy="true"
    >
      <span className="sr-only">Loading property</span>
      <div className="lg:col-start-1">
        <div className="skeleton mt-4 h-4 w-24" />
        <div className="skeleton mt-6 h-9 w-3/4 md:h-11" />
        <div className="skeleton mt-2 h-4 w-1/2" />
      </div>

      <div className="mt-6 border-y border-rule py-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-8 lg:self-start lg:rounded-lg lg:border lg:p-6">
        <div className="skeleton h-9 w-32" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-3 grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3">
            <div className="skeleton h-4" />
            <div className="skeleton h-1" />
            <div className="skeleton h-4" />
          </div>
        ))}
      </div>

      <div className="lg:col-start-1">
        <div className="skeleton mt-6 h-36 rounded-lg" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-6 border-t border-rule pt-6">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton mt-4 h-4" />
            <div className="skeleton mt-2 h-4" />
            <div className="skeleton mt-2 h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}
