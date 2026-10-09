/** Skeleton for the directory while the server runs the property query. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 md:px-6 md:pt-10" aria-busy="true">
      <span className="sr-only">Loading properties</span>
      <div className="skeleton h-9 w-4/5 max-w-xl md:h-11" />
      <div className="skeleton mt-4 h-5 w-3/5 max-w-md" />
      <div className="skeleton mt-6 h-12 max-w-2xl" />
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-x-12 lg:mt-10 lg:grid-cols-[15rem_minmax(0,45rem)]">
        <div className="skeleton h-11 lg:h-96" />
        <ul className="mt-4 lg:mt-0">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex gap-4 border-b border-rule py-4">
              <div className="flex-1">
                <div className="skeleton h-6 w-1/2" />
                <div className="skeleton mt-2 h-4 w-1/3" />
                <div className="skeleton mt-2 h-4 w-2/5" />
              </div>
              <div className="skeleton h-7 w-12" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
