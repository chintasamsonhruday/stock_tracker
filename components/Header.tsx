import Link from "next/link";
import Image from "next/image";
import NavItems from "@/components/NavItems";
import UserDropdown from "@/components/UserDropdown";
import {searchStocks} from "@/lib/actions/finnhub.actions";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";

const Header = async ({ user }: { user: User }) => {
    const [stocks, watchlistItems] = await Promise.all([
        searchStocks(),
        getUserWatchlist(user.id),
    ]);
    const watchlistSymbols = watchlistItems.map((item: { symbol: string }) => item.symbol.toUpperCase());
    const initialStocks = stocks.map((stock) => ({
        ...stock,
        isInWatchlist: watchlistSymbols.includes(stock.symbol.toUpperCase()),
    }));

    return (
        <header className="sticky top-0 header">
            <div className="container header-wrapper">
                <Link href="/" className="flex items-center justify-center gap-2">
                    <Image
                        src="/assets/images/logo.png"
                        alt="OpenStock"
                        width={200}
                        height={50}
                    />
                </Link>
                <nav className="hidden sm:block">
                    <NavItems initialStocks={initialStocks} userId={user.id} initialWatchlistSymbols={watchlistSymbols}/>
                </nav>

                <UserDropdown user={user} initialStocks={initialStocks} initialWatchlistSymbols={watchlistSymbols} />
            </div>
        </header>
    )
}
export default Header
