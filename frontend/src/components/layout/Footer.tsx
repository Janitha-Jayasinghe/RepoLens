
export default function Footer() {
  return (
    <footer className="mt-auto w-full border-t border-white/10 bg-black px-6 py-5">
      <div className="flex flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-white/60">
          Designed & Developed by{" "}
          <span className="font-semibold text-[#FF5F00]">
            Janitha Jayasinghe
          </span>
        </p>

        <p className="text-xs text-white/40">
          © {new Date().getFullYear()} RepoLens.
          All rights reserved.
        </p>
      </div>
    </footer>
  );
}
