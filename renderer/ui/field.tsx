import * as React from "react";

import { cn } from "./utils";
import { Label } from "./label";
import { Text } from "./text";

export interface FieldProps extends Omit<React.ComponentProps<"div">, "onClick"> {
  label?: React.ReactNode;
  htmlFor?: string;
  description?: React.ReactNode;
  error?: React.ReactNode;
  orientation?: "vertical" | "horizontal" | "responsive";
  onClick?: React.MouseEventHandler<HTMLElement>;
  disabled?: boolean;
}

export function Field({
  label,
  htmlFor,
  description,
  error,
  orientation,
  onClick,
  disabled,
  className,
  children,
  ...props
}: FieldProps) {
  const resolvedOrientation = orientation ?? (onClick ? "horizontal" : "vertical");
  const body = (
    <>
      {label || description ? (
        <FieldContent>
          {label ? <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel> : null}
          {description ? <FieldDescription>{description}</FieldDescription> : null}
        </FieldContent>
      ) : null}
      {children}
    </>
  );
  const classes = cn(
    "flex gap-3 px-3 py-2.5 min-w-0",
    resolvedOrientation === "horizontal" && "flex-row items-center justify-between",
    resolvedOrientation === "responsive" &&
      "flex-col @md:flex-row @md:items-center @md:justify-between",
    resolvedOrientation === "vertical" && "flex-col",
    disabled && "opacity-40",
    error && "data-[invalid]:text-support-red",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        role="group"
        disabled={disabled}
        onClick={onClick}
        className={cn(classes, "w-full text-left hover:bg-list-hover")}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {body}
        {error ? <FieldError>{error}</FieldError> : null}
      </button>
    );
  }
  return (
    <div role="group" className={classes} {...props}>
      {body}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

export function FieldSet({
  title,
  description,
  className,
  children,
  ...props
}: React.ComponentProps<"fieldset"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
}) {
  const hasGroup = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === FieldGroup,
  );
  return (
    <fieldset className={cn("flex flex-col gap-2", className)} {...props}>
      {title ? <FieldLegend>{title}</FieldLegend> : null}
      {description ? <FieldDescription className="mx-3">{description}</FieldDescription> : null}
      {hasGroup ? children : <FieldGroup>{children}</FieldGroup>}
    </fieldset>
  );
}

export function FieldLegend({
  variant = "legend",
  className,
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      className={cn(
        "text-small-strong font-medium text-secondary",
        variant === "legend" && "mx-3",
        className,
      )}
      {...props}
    />
  );
}

export function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col divide-y divide-separator rounded-xl bg-well", className)}
      {...props}
    />
  );
}

export function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)} {...props} />;
}

export function FieldLabel({ className, htmlFor, ...props }: React.ComponentProps<typeof Label>) {
  return <Label htmlFor={htmlFor} className={cn("text-regular", className)} {...props} />;
}

export function FieldTitle({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("text-regular text-primary", className)} {...props} />;
}

export function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <Text
      {...props}
      as="p"
      variant="small"
      color="tertiary"
      className={cn("max-w-[350px] [&_a]:underline", className)}
    />
  );
}

export function FieldSeparator({ className, children, ...props }: React.ComponentProps<"div">) {
  if (!children) return <div className={cn("h-px bg-separator", className)} {...props} />;
  return (
    <div
      className={cn("relative flex items-center py-1 text-small text-tertiary", className)}
      {...props}
    >
      <div className="h-px flex-1 bg-separator" />
      <span className="px-2">{children}</span>
      <div className="h-px flex-1 bg-separator" />
    </div>
  );
}

export interface FieldErrorProps extends React.ComponentProps<"div"> {
  errors?: Array<{ message?: string } | undefined>;
}

export function FieldError({ className, children, errors, ...props }: FieldErrorProps) {
  const messages = errors
    ? Array.from(new Set(errors.map((error) => error?.message).filter(Boolean)))
    : [];
  if (!children && messages.length === 0) return null;
  return (
    <div role="alert" className={cn("px-3 pb-2 text-small text-support-red", className)} {...props}>
      {children ??
        (messages.length === 1 ? (
          messages[0]
        ) : (
          <ul className="list-disc pl-4">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ))}
    </div>
  );
}
