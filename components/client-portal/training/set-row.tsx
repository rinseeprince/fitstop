type SetRowProps = {
  setNumber: number;
  weightPlaceholder?: string;
  repsPlaceholder?: string;
  rpePlaceholder?: string;
};

export function SetRow({
  setNumber,
  weightPlaceholder,
  repsPlaceholder,
  rpePlaceholder,
}: SetRowProps) {
  return (
    <div
      data-testid="set-row"
      className="grid grid-cols-12 items-center gap-2 px-3 py-2"
    >
      <div className="col-span-2 text-center text-[13px] font-mono-display text-[#5a7d82]">
        {setNumber}
      </div>
      <PlaceholderCell colSpan={4} hint={weightPlaceholder} />
      <PlaceholderCell colSpan={3} hint={repsPlaceholder} />
      <PlaceholderCell colSpan={3} hint={rpePlaceholder} />
    </div>
  );
}

function PlaceholderCell({
  colSpan,
  hint,
}: {
  colSpan: 3 | 4;
  hint: string | undefined;
}) {
  const span = colSpan === 4 ? "col-span-4" : "col-span-3";
  return (
    <div className={span}>
      <div className="flex h-9 items-center justify-center rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.02)] text-[12px] font-mono-display text-[#93b0b4]">
        {hint ?? "—"}
      </div>
    </div>
  );
}
