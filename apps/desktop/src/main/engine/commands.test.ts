/** @vitest-environment node */
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandWrites, writtenPaths } from "./commands";

/** The files a command writes, from /w, as the policy sees them before it looks at the disk. */
const writes = (command: string, cwd = "/w") =>
  commandWrites(command, cwd, "/home/me").targets.map((t) => (t.from ? `${t.path} <- ${t.from.path}` : t.path));

/** PowerShell's -EncodedCommand text: base64 of UTF-16LE. */
const encoded = (script: string) => Buffer.from(script, "utf16le").toString("base64");

describe("commandWrites", () => {
  it("finds the files bash redirections write, wrapped in a shell or not", () => {
    const cases: [string, string[]][] = [
      ["printf 'v9' > note.txt", ["/w/note.txt"]],
      [`/bin/bash -lc "printf 'v9' > note.txt"`, ["/w/note.txt"]],
      ["echo x >> log.txt", ["/w/log.txt"]],
      ["make 2> err.txt", ["/w/err.txt"]],
      ["make &> all.txt", ["/w/all.txt"]],
      ["make &>> all.txt", ["/w/all.txt"]],
      ["echo x >| forced.txt", ["/w/forced.txt"]],
      ["echo x 1> one.txt", ["/w/one.txt"]],
      ["echo x>tight.txt", ["/w/tight.txt"]],
      ["cat > 'my notes.txt' <<'EOF'\nhello > not-a-file.txt\nEOF", ["/w/my notes.txt"]],
      ['printf x > "/w/sub folder/a b.txt"', ["/w/sub folder/a b.txt"]],
      ["printf x > ../up.txt", ["/up.txt"]],
      ["echo x | tee copy.txt", ["/w/copy.txt"]],
      ["echo x | tee -a one.txt two.txt", ["/w/one.txt", "/w/two.txt"]],
      ["sudo tee /w/root.txt < in.txt", ["/w/root.txt"]],
      ["x=$(printf a > inner.txt)", ["/w/inner.txt"]],
      [`sh -c 'bash -c "echo x > deep.txt"'`, ["/w/deep.txt"]],
      ["bash <<< 'echo x > fed.txt'", ["/w/fed.txt"]],
      ["printf x > ~/home.txt", ["/home/me/home.txt"]],
      ['printf x > "$PWD/here.txt"', ["/w/here.txt"]],
      ["cd sub && printf x > $PWD/here.txt", ["/w/sub/here.txt"]],
    ];
    for (const [command, expected] of cases) expect(writes(command), command).toEqual(expected);
  });

  it("leaves out what isn't a file: other streams, /dev/null, input, variables and command output", () => {
    for (const command of [
      "make 2>&1 | less",
      "make >&2",
      "make > /dev/null 2>&1",
      "sort < in.txt",
      "cat <<EOF\nx\nEOF",
      'printf x > "$OUT"',
      "printf x > $(date).txt",
      "printf x > `name`.txt",
      "echo x | tee",
      "echo x | tee -",
      "echo 'printf x > quoted.txt'",
      "echo x 2>nul",
    ])
      expect(writes(command), command).toEqual([]);
  });

  it("follows the command's cd, and leaves relative paths alone after a cd it can't follow", () => {
    expect(writes("cd sub && printf x > a.txt")).toEqual(["/w/sub/a.txt"]);
    expect(writes(`/bin/bash -lc "cd 'my docs' && printf x > a.txt; cd .. ; echo y > b.txt"`)).toEqual([
      "/w/my docs/a.txt",
      "/w/b.txt",
    ]);
    expect(writes('cd "$DIR" && printf x > a.txt && printf y > /w/abs.txt')).toEqual(["/w/abs.txt"]);
    expect(commandWrites("cd sub", "/w").cwd).toBe("/w/sub");
  });

  it("finds what programs write from their arguments", () => {
    const cases: [string, string[]][] = [
      ["cp a.txt b.txt", ["/w/b.txt <- /w/a.txt"]],
      ["cp -f a.txt b.txt", ["/w/b.txt <- /w/a.txt"]],
      ["cp a.txt c.txt docs", ["/w/docs <- /w/a.txt", "/w/docs <- /w/c.txt"]],
      ["cp -t docs a.txt", ["/w/docs <- /w/a.txt"]],
      ["cp --target-directory=docs a.txt", ["/w/docs <- /w/a.txt"]],
      ["mv -- -odd.txt b.txt", ["/w/b.txt <- /w/-odd.txt"]],
      ["install -m 644 a.txt /w/b.txt", ["/w/b.txt <- /w/a.txt"]],
      ["install -d folder", []],
      ["ln -sf a.txt b.txt", ["/w/b.txt <- /w/a.txt"]],
      ["ln -s a.txt b.txt", []],
      ["rsync -av -e ssh a.txt b.txt", ["/w/b.txt <- /w/a.txt"]],
      ["rsync a.txt host:b.txt", []],
      ["sed -i 's/a/b/' note.txt", ["/w/note.txt"]],
      ["sed -i.bak -e 's/a/b/' -e 's/c/d/' one.txt two.txt", ["/w/one.txt", "/w/two.txt"]],
      ["sed -i '' 's/a/b/' mac.txt", ["/w/mac.txt"]],
      ["sed --in-place=.bak 's/a/b/' long.txt", ["/w/long.txt"]],
      ["sed -n 's/a/b/p' read.txt", []],
      ["perl -pi -e 's/a/b/' note.txt", ["/w/note.txt"]],
      ["perl -i.bak -pe 's/a/b/' note.txt", ["/w/note.txt"]],
      ["perl -Mstrict -e 'print 1' read.txt", []],
      ["truncate -s 0 log.txt", ["/w/log.txt"]],
      ["dd if=a.bin of=b.bin bs=1M", ["/w/b.bin"]],
      ["touch note.txt", []],
      ["sort -o sorted.txt list.txt", ["/w/sorted.txt"]],
      ["sort -uo sorted.txt list.txt", ["/w/sorted.txt"]],
      ["sort --output=sorted.txt list.txt", ["/w/sorted.txt"]],
      ["sort -k 2 list.txt", []],
      ["curl -sSL https://x.example/a -o page.html", ["/w/page.html"]],
      ["curl --output page.html https://x.example/a", ["/w/page.html"]],
      ["curl -O https://x.example/a.html", []],
      ["wget -O page.html https://x.example/", ["/w/page.html"]],
      ["wget -qO page.html https://x.example/", ["/w/page.html"]],
      ["wget -O - https://x.example/", []],
      ["sudo -E cp a.txt b.txt", ["/w/b.txt <- /w/a.txt"]],
      ["timeout 10 cp a.txt b.txt", ["/w/b.txt <- /w/a.txt"]],
      // The files find hands to {} aren't known from the words.
      ["find . -name '*.md' -exec sed -i 's/a/b/' {} +", []],
      ["ls | xargs -0 sed -i 's/a/b/' note.txt", ["/w/note.txt"]],
      ["/usr/bin/cp a.txt b.txt", ["/w/b.txt <- /w/a.txt"]],
    ];
    for (const [command, expected] of cases) expect(writes(command), command).toEqual(expected);
  });

  it("finds what OfficeCLI's changes write, and not its reads", () => {
    const cases: [string, string[]][] = [
      ['officecli set "Contratto.docx" / --find "Alberto" --replace "Alberto P"', ["/w/Contratto.docx"]],
      ['officecli add "Proposta Alpi.docx" /body --type paragraph --prop text="Ciao"', ["/w/Proposta Alpi.docx"]],
      ["officecli remove budget.xlsx '/Sheet1/row[3]'", ["/w/budget.xlsx"]],
      ["officecli move deck.pptx '/slide[2]' --to 1", ["/w/deck.pptx"]],
      ["officecli swap deck.pptx '/slide[1]' '/slide[2]'", ["/w/deck.pptx"]],
      ["officecli raw-set report.docx /document --xpath x --action replace --xml y", ["/w/report.docx"]],
      ["officecli batch report.docx --commands '[]'", ["/w/report.docx"]],
      ["officecli import budget.xlsx /Sheet1 data.csv", ["/w/budget.xlsx"]],
      ["officecli merge template.docx out.docx --data '{}'", ["/w/out.docx"]],
      ["officecli refresh report.docx", ["/w/report.docx"]],
      ["officecli create --force new.docx", ["/w/new.docx"]],
      ["officecli --json set report.docx / --prop title=X", ["/w/report.docx"]],
      [`/bin/bash -lc "officecli set 'Contratto.docx' / --prop author=Me"`, ["/w/Contratto.docx"]],
      ["/opt/tost/officecli add notes.docx /body --type paragraph", ["/w/notes.docx"]],
    ];
    for (const [command, expected] of cases) expect(writes(command), command).toEqual(expected);
    expect(writes("officecli.exe add notes.docx /body", "C:\\w")).toEqual(["C:\\w\\notes.docx"]);
    for (const command of [
      "officecli create new.docx",
      "officecli view report.docx outline",
      "officecli get report.docx /body",
      "officecli query report.docx 'p'",
      "officecli validate report.docx",
      "officecli raw report.docx /document",
      "officecli dump report.docx /",
      "officecli help docx paragraph",
      "officecli close report.docx",
    ])
      expect(writes(command), command).toEqual([]);
  });

  it("finds what PowerShell writes, through Codex's and Claude Code's wrappers", () => {
    const win = (command: string) => writes(command, "C:\\w");
    const cases: [string, string[]][] = [
      ["Set-Content -Path note.txt -Value 'v9'", ["C:\\w\\note.txt"]],
      ["Set-Content note.txt 'v9'", ["C:\\w\\note.txt"]],
      ["sc -Path:note.txt -Value v9", ["C:\\w\\note.txt"]],
      ["Add-Content -LiteralPath 'C:\\w\\my notes.txt' -Value x", ["C:\\w\\my notes.txt"]],
      ["ac log.txt x", ["C:\\w\\log.txt"]],
      ["Clear-Content .\\log.txt", ["C:\\w\\log.txt"]],
      ["'x' | Out-File -FilePath out.txt -Encoding utf8", ["C:\\w\\out.txt"]],
      ["'x' | Out-File out.txt -Append", ["C:\\w\\out.txt"]],
      ["$rows | Export-Csv -Path list.csv -NoTypeInformation", ["C:\\w\\list.csv"]],
      ["'x' | Tee-Object -FilePath t.txt", ["C:\\w\\t.txt"]],
      ["'x' | tee -FilePath t.txt", ["C:\\w\\t.txt"]],
      ["Copy-Item a.txt b.txt", ["C:\\w\\b.txt <- C:\\w\\a.txt"]],
      ["Copy-Item -Path a.txt -Destination docs -Force", ["C:\\w\\docs <- C:\\w\\a.txt"]],
      ["copy -Path a.txt -Destination b.txt", ["C:\\w\\b.txt <- C:\\w\\a.txt"]],
      ["cp -r a.txt b.txt", ["C:\\w\\b.txt <- C:\\w\\a.txt"]],
      ["Move-Item -Path a.txt -Dest b.txt", ["C:\\w\\b.txt <- C:\\w\\a.txt"]],
      ["mv a.txt b.txt -Force", ["C:\\w\\b.txt <- C:\\w\\a.txt"]],
      ["Rename-Item -Path docs\\a.txt -NewName b.txt", ["C:\\w\\docs\\b.txt"]],
      ["ren -Path a.txt -NewName b.txt", ["C:\\w\\b.txt"]],
      ["'v9' > note.txt", ["C:\\w\\note.txt"]],
      ["Get-Thing *> all.txt", ["C:\\w\\all.txt"]],
      ["Get-Thing 2>> err.txt", ["C:\\w\\err.txt"]],
      ["Get-Thing > $null", []],
      ["[IO.File]::WriteAllText('C:\\w\\note.txt', 'v9')", ["C:\\w\\note.txt"]],
      ['[System.IO.File]::AppendAllLines("log.txt", $lines)', ["C:\\w\\log.txt"]],
      ["[IO.File]::Copy('a.txt', 'b.txt', $true)", ["C:\\w\\b.txt"]],
      ["[IO.File]::WriteAllText(\"$PWD\\note.txt\", 'v9')", ["C:\\w\\note.txt"]],
      ["[IO.File]::WriteAllText(\"$dir\\note.txt\", 'v9')", []],
      ["Set-Location docs; Set-Content a.txt x", ["C:\\w\\docs\\a.txt"]],
      // Codex on Windows runs PowerShell by its full path, quoted.
      [
        `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Set-Content -Path note.txt -Value v9'`,
        ["C:\\w\\note.txt"],
      ],
      [`pwsh -NoProfile -Command "'v9' | Out-File note.txt"`, ["C:\\w\\note.txt"]],
      [`powershell -EncodedCommand ${encoded("Set-Content note.txt v9")}`, ["C:\\w\\note.txt"]],
      ["powershell -File script.ps1", []],
    ];
    for (const [command, expected] of cases) expect(win(command), command).toEqual(expected);
  });

  it("finds what cmd writes", () => {
    const win = (command: string) => writes(command, "C:\\w");
    const cases: [string, string[]][] = [
      ["echo v9> note.txt", ["C:\\w\\note.txt"]],
      ["cmd /c echo v9 ^> note.txt", ["C:\\w\\note.txt"]],
      ['cmd /d /s /c "type a.txt >> b.txt"', ["C:\\w\\b.txt"]],
      ["copy /Y a.txt b.txt", ["C:\\w\\b.txt <- C:\\w\\a.txt"]],
      ["copy C:\\in\\a.txt", ["C:\\w <- C:\\in\\a.txt"]],
      ["move a.txt D:\\out\\b.txt", ["D:\\out\\b.txt <- C:\\w\\a.txt"]],
      ["xcopy /E /I a.txt docs\\", ["C:\\w\\docs <- C:\\w\\a.txt"]],
      ["ren docs\\a.txt b.txt", ["C:\\w\\docs\\b.txt"]],
      ["cd /d C:\\w\\docs && echo x > a.txt", ["C:\\w\\docs\\a.txt"]],
      ["echo x > NUL", []],
    ];
    for (const [command, expected] of cases) expect(win(command), command).toEqual(expected);
  });
});

describe("writtenPaths", () => {
  it("expands globs against the folder and puts a copy into a folder under its source's name", async () => {
    const work = await realpath(await mkdtemp(join(tmpdir(), "tw-writes-")));
    await mkdir(join(work, "docs"));
    for (const name of ["a.txt", "b.txt", "c.md", ".hidden.txt", "docs/a.txt"]) await writeFile(join(work, name), "x");
    const paths = async (command: string) =>
      (await writtenPaths(commandWrites(command, work).targets, work)).map((p) => p.slice(work.length + 1)).sort();
    expect(await paths("sed -i 's/x/y/' *.txt")).toEqual(["a.txt", "b.txt"]);
    expect(await paths("sed -i 's/x/y/' '*.txt'")).toEqual(["*.txt"]);
    expect(await paths("sed -i 's/x/y/' [ab].txt ?.md")).toEqual(["a.txt", "b.txt", "c.md"]);
    expect(await paths("cp a.txt docs")).toEqual(["docs/a.txt"]);
    expect(await paths("cp *.txt docs/")).toEqual(["docs/a.txt", "docs/b.txt"]);
    expect(await paths("cp $SRC docs")).toEqual([]);
    expect(await paths("cp a.txt new-folder/")).toEqual(["new-folder/a.txt"]);
    expect(await paths("printf x > *.nothing")).toEqual([]);
  });
});
