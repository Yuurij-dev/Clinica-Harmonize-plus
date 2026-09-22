"use client";

import { InputHTMLAttributes, useState } from "react";

type MaskedInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "type" | "value" | "defaultValue"
> & {
  defaultValue?: string;
  formatter: (value: string) => string;
};

export function MaskedInput({
  defaultValue = "",
  formatter,
  ...props
}: MaskedInputProps) {
  const [value, setValue] = useState(() => formatter(defaultValue));

  return (
    <input
      {...props}
      type="text"
      value={value}
      onChange={(event) => setValue(formatter(event.currentTarget.value))}
    />
  );
}
