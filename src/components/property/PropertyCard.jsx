import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowRight, FiTrendingUp, FiDollarSign, FiUsers } from 'react-icons/fi';
import { FaEthereum } from 'react-icons/fa';

import { formatEth, formatNumber, formatPercent, formatUsd, toBarWidth } from '../../utils/format';

/**
 * Listing card, shared by the home page and the listings grid.
 *
 * Previously each page rendered its own card from its own copy of the data, which is how
 * the same listing ended up with a different title and location depending on where you
 * looked. One component over one API shape removes that.
 *
 * The whole card is a single link and the call to action is styled text rather than a
 * nested `<button>` - the original markup put an interactive button inside an anchor, which
 * is invalid HTML and makes keyboard and screen-reader behaviour unpredictable.
 */

const STAGE_STYLES = {
  new: 'bg-blue-50 text-blue-700',
  active: 'bg-emerald-50 text-emerald-700',
  almost_funded: 'bg-amber-50 text-amber-700',
};

function PropertyCard({ property, index = 0 }) {
  const { metrics, price, status, tokenDetails } = property;

  return (
    <motion.article
      data-testid="property-card"
      className="bg-white rounded-lg shadow-md overflow-hidden h-full"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.06, 0.3), duration: 0.25 }}
    >
      <Link
        to={`/properties/${property.id}`}
        className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        aria-label={`View ${property.title} in ${property.location.label}`}
      >
        <div className="relative h-48 bg-secondary-100">
          <img
            src={property.image}
            alt={property.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <span
            className={`absolute top-4 right-4 px-3 py-1 rounded-full text-sm font-semibold ${
              STAGE_STYLES[status.stage] || 'bg-white text-primary-600'
            }`}
          >
            {status.label}
          </span>
        </div>

        <div className="p-6">
          <h3 className="text-xl font-semibold mb-1">{property.title}</h3>
          <p className="text-secondary-600 mb-4">{property.location.label}</p>

          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm text-secondary-500">Property value</p>
              <div className="flex items-center">
                <FiDollarSign className="text-primary-600" aria-hidden="true" />
                <span className="font-semibold">{formatUsd(price.usd)}</span>
              </div>
              <div className="flex items-center text-sm text-primary-600">
                <FaEthereum className="mr-1" aria-hidden="true" />
                <span>{formatEth(price.eth)}</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-secondary-500">Total annual return</p>
              <div className="flex items-center justify-end text-green-600">
                <FiTrendingUp className="mr-1" aria-hidden="true" />
                <span className="font-semibold">{formatPercent(metrics.totalAnnualReturnPct)}</span>
              </div>
              <p className="text-xs text-secondary-500 mt-0.5">
                {formatPercent(metrics.netYieldPct)} yield +{' '}
                {formatPercent(metrics.appreciationPct)} growth
              </p>
            </div>
          </div>

          <dl className="space-y-2 mb-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-secondary-600">Monthly income per $1,000</dt>
              <dd className="font-medium">{formatUsd(metrics.monthlyIncomePer1000Usd, { cents: true })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary-600">Minimum investment</dt>
              <dd className="font-medium">{formatUsd(metrics.minInvestmentUsd)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-secondary-600 flex items-center">
                <FiUsers className="mr-1" size={14} aria-hidden="true" />
                Investors
              </dt>
              <dd className="font-medium">{formatNumber(metrics.totalInvestors)}</dd>
            </div>
          </dl>

          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-secondary-600">Funding progress</span>
              <span className="font-medium">{formatPercent(metrics.fundedPct, { decimals: 0 })}</span>
            </div>
            <div
              className="w-full bg-secondary-100 rounded-full h-2"
              role="progressbar"
              aria-valuenow={metrics.fundedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Funding progress"
            >
              <div
                className="bg-primary-600 h-2 rounded-full transition-all"
                style={{ width: toBarWidth(metrics.fundedPct) }}
              />
            </div>
          </div>

          <div className="bg-secondary-50 rounded-lg p-3 mb-4 text-sm">
            <div className="flex justify-between">
              <span className="text-secondary-600">Tokens available</span>
              <span className="font-medium">
                {formatNumber(tokenDetails.availableTokens)} / {formatNumber(tokenDetails.totalTokens)}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-secondary-600">Token price</span>
              <span className="font-medium">{formatUsd(tokenDetails.tokenPriceUsd)}</span>
            </div>
          </div>

          <span className="btn w-full flex items-center justify-center" aria-hidden="true">
            View investment
            <FiArrowRight className="ml-2" />
          </span>
        </div>
      </Link>
    </motion.article>
  );
}

export default PropertyCard;
