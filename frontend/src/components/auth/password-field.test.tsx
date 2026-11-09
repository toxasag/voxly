import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordField } from "./PasswordField";

describe("PasswordField component", () => {
  it("renders with initial type='password' and accessible toggle button", () => {
    render(<PasswordField id="test_pass" label="Пароль" defaultValue="Secret123" />);

    const input = screen.getByLabelText("Пароль") as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.type).toBe("password");
    expect(input.value).toBe("Secret123");

    const toggleButton = screen.getByRole("button", { name: "Показать пароль" });
    expect(toggleButton).toBeDefined();
    expect(toggleButton.getAttribute("type")).toBe("button");
    expect(toggleButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles input type to 'text' and updates button aria-label to 'Скрыть пароль'", () => {
    render(<PasswordField id="test_pass" label="Текущий пароль" defaultValue="MyP@ssw0rd!" />);

    const input = screen.getByLabelText("Текущий пароль") as HTMLInputElement;
    const toggleButton = screen.getByRole("button", { name: "Показать пароль" });

    // Click toggle to reveal password
    fireEvent.click(toggleButton);

    expect(input.type).toBe("text");
    expect(input.value).toBe("MyP@ssw0rd!");
    expect(toggleButton.getAttribute("aria-label")).toBe("Скрыть пароль");
    expect(toggleButton.getAttribute("aria-pressed")).toBe("true");

    // Click toggle again to hide password
    fireEvent.click(toggleButton);

    expect(input.type).toBe("password");
    expect(toggleButton.getAttribute("aria-label")).toBe("Показать пароль");
    expect(toggleButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("resolves dummy bullet placeholder to readable text when password is visible", () => {
    render(<PasswordField id="test_pass" label="Пароль" placeholder="••••••••" />);

    const input = screen.getByLabelText("Пароль") as HTMLInputElement;
    expect(input.placeholder).toBe("••••••••");

    const toggleButton = screen.getByRole("button", { name: "Показать пароль" });
    fireEvent.click(toggleButton);

    expect(input.placeholder).toBe("Введите пароль");
  });
});
