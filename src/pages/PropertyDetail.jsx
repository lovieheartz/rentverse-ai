import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiCalendar,
  FiDollarSign,
  FiGrid,
  FiHome,
  FiMaximize2,
  FiTrendingUp,
  FiUsers,
} from 'react-icons/fi';
import { FacebookShareButton, TwitterShareButton, LinkedinShareButton } from 'react-share';
import { FaFacebook, FaTwitter, FaLinkedin, FaEthereum, FaWallet } from 'react-icons/fa';

import InvestmentAnalysisPanel from '../components/property/InvestmentAnalysisPanel';
import { EmptyState, ErrorState, Spinner } from '../components/common/StateViews';
import { useProperty } from '../hooks/useProperties';
import {
  formatEth,
  formatNumber,
  formatPercent,
  formatUsd,
  humaniseKey,
  toBarWidth,
} from '../utils/format';

/**
 * Property detail.
 *
 * The route parameter now actually selects the listing. Previously this page declared a
 * single hardcoded property object and rendered it for every id, so every listing in the
 * catalogue opened the same Beverly Hills villa - the most visible bug in the main flow.
 */

function DetailSkeleton() {
  return (
    <div className="container py-8 animate-pulse" aria-hidden="true">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-96 bg-secondary-200 rounded-lg" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-32 bg-secondary-100 rounded-lg" />
            <div className="h-32 bg-secondary-100 rounded-lg" />
            <div className="h-32 bg-secondary-100 rounded-lg" />
          </div>
          <div className="h-64 bg-secondary-100 rounded-lg" />
        </div>
        <div className="space-y-4">
          <div className="h-80 bg-secondary-100 rounded-lg" />
          <div className="h-48 bg-secondary-100 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function PropertyDetail() {
  const { id } = useParams();
  const { data: property, error, isLoading, refetch } = useProperty(id);
  const [activeImage, setActiveImage] = useState(0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-secondary-50">
        <div className="sr-only" role="status">
          <Spinner label="Loading property" />
        </div>
        <DetailSkeleton />
      </div>
    );
  }

  if (error) {
    const isMissing = error.code === 'NOT_FOUND';

    return (
      <div className="min-h-screen bg-secondary-50">
        <div className="container py-12 max-w-2xl">
          {isMissing ? (
            <EmptyState
              title="This listing does not exist"
              message={`No property is listed under the id "${id}". It may have been withdrawn or fully funded.`}
              action={
                <Link to="/properties" className="btn">
                  Browse all listings
                </Link>
              }
            />
          ) : (
            <ErrorState error={error} onRetry={refetch} title="Could not load this listing" />
          )}
        </div>
      </div>
    );
  }

  if (!property) return null;

  const { metrics, financials, tokenDetails, details, price, status, advisor } = property;
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className="min-h-screen bg-secondary-50">
      <div className="bg-white shadow">
        <div className="container py-4">
          <nav className="flex items-center space-x-2 text-sm" aria-label="Breadcrumb">
            <Link to="/" className="text-secondary-600 hover:text-primary-600">
              Home
            </Link>
            <span className="text-secondary-400" aria-hidden="true">
              /
            </span>
            <Link to="/properties" className="text-secondary-600 hover:text-primary-600">
              Properties
            </Link>
            <span className="text-secondary-400" aria-hidden="true">
              /
            </span>
            <span className="text-primary-600" aria-current="page">
              {property.title}
            </span>
          </nav>
        </div>
      </div>

      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="h-96 rounded-lg overflow-hidden bg-secondary-100">
                <img
                  src={property.images[activeImage]}
                  alt={property.title}
                  className="w-full h-full object-cover"
                />
              </div>
              {property.images.length > 1 && (
                <div className="grid grid-cols-3 gap-4">
                  {property.images.map((image, index) => (
                    <button
                      key={image}
                      type="button"
                      onClick={() => setActiveImage(index)}
                      aria-label={`Show image ${index + 1} of ${property.images.length}`}
                      aria-pressed={index === activeImage}
                      className={`h-32 rounded-lg overflow-hidden border-2 transition ${
                        index === activeImage ? 'border-primary-600' : 'border-transparent'
                      }`}
                    >
                      <img
                        src={image}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-lg shadow-md p-6"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                <div>
                  <h1 className="text-2xl font-bold">{property.title}</h1>
                  <p className="text-secondary-600">{property.location.label}</p>
                </div>
                <span className="bg-primary-50 text-primary-700 px-3 py-1 rounded-full text-sm font-semibold">
                  {status.label}
                </span>
              </div>

              <p className="text-secondary-600 mb-6 leading-relaxed">{property.description}</p>

              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="flex items-center space-x-2">
                  <FiHome className="text-primary-600" aria-hidden="true" />
                  <div>
                    <dt className="sr-only">Parking spaces</dt>
                    <dd>{details.parkingSpaces} parking</dd>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <FiMaximize2 className="text-primary-600" aria-hidden="true" />
                  <div>
                    <dt className="sr-only">Interior area</dt>
                    <dd>{formatNumber(details.interiorSqFt)} sq ft</dd>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <FiCalendar className="text-primary-600" aria-hidden="true" />
                  <div>
                    <dt className="sr-only">Year built</dt>
                    <dd>Built {details.yearBuilt}</dd>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <FiUsers className="text-primary-600" aria-hidden="true" />
                  <div>
                    <dt className="sr-only">Investors</dt>
                    <dd>{formatNumber(metrics.totalInvestors)} investors</dd>
                  </div>
                </div>
              </dl>

              <h2 className="text-xl font-semibold mb-4">Features</h2>
              <ul className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                {property.features.map((feature) => (
                  <li key={feature} className="flex items-center space-x-2">
                    <FiHome className="text-primary-600 flex-shrink-0" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <h2 className="text-xl font-semibold mb-4">Token information</h2>
              <div className="bg-secondary-50 rounded-lg p-6 mb-6">
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-sm text-secondary-600">Token symbol</dt>
                    <dd className="font-semibold">{tokenDetails.symbol}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-secondary-600">Token price</dt>
                    <dd className="font-semibold">{formatUsd(tokenDetails.tokenPriceUsd)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-secondary-600">Tokens available</dt>
                    <dd className="font-semibold">{formatNumber(tokenDetails.availableTokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-secondary-600">Total supply</dt>
                    <dd className="font-semibold">{formatNumber(tokenDetails.totalTokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-secondary-600">Capital raised</dt>
                    <dd className="font-semibold">{formatUsd(tokenDetails.raisedUsd)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-secondary-600">Blockchain</dt>
                    <dd className="font-semibold">{tokenDetails.blockchain}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-sm text-secondary-600">Smart contract</dt>
                    <dd className="font-mono text-sm break-all">{tokenDetails.contractAddress}</dd>
                  </div>
                </dl>
              </div>

              <h2 className="text-xl font-semibold mb-4">Financial overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-secondary-50 rounded-lg p-6">
                  <h3 className="font-semibold mb-4">Rental income</h3>
                  <dl className="space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-secondary-600">Gross rent (monthly)</dt>
                      <dd className="font-medium">{formatUsd(financials.grossMonthlyRentUsd)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-secondary-600">Net rent (monthly)</dt>
                      <dd className="font-medium">{formatUsd(financials.netMonthlyRentUsd)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-secondary-600">Net rent (annual)</dt>
                      <dd className="font-medium">{formatUsd(financials.netAnnualRentUsd)}</dd>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-secondary-200">
                      <dt className="text-secondary-600">Per $1,000 invested</dt>
                      <dd className="font-medium">
                        {formatUsd(metrics.monthlyIncomePer1000Usd, { cents: true })}/mo
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="bg-secondary-50 rounded-lg p-6">
                  <h3 className="font-semibold mb-4">
                    Operating expenses ({formatPercent(financials.totalExpenseRatioPct)} of gross rent)
                  </h3>
                  <dl className="space-y-2">
                    {Object.entries(financials.expenseRatios).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <dt className="text-secondary-600">{humaniseKey(key)}</dt>
                        <dd className="font-medium">{formatPercent(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </motion.div>

            {/* The AI feature sits here: at the point where the user is deciding. */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <InvestmentAnalysisPanel propertyId={property.id} propertyTitle={property.title} />
            </motion.div>
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-lg shadow-md p-6 lg:sticky lg:top-6">
              <div className="flex justify-between items-start mb-4 gap-4">
                <div>
                  <p className="text-sm text-secondary-500">Property value</p>
                  <div className="flex items-center">
                    <FiDollarSign className="text-primary-600" aria-hidden="true" />
                    <span className="text-2xl font-bold">{formatUsd(price.usd)}</span>
                  </div>
                  <div className="flex items-center text-primary-600">
                    <FaEthereum className="mr-1" aria-hidden="true" />
                    <span>{formatEth(price.eth)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-secondary-500">Total annual return</p>
                  <div className="flex items-center justify-end text-green-600">
                    <FiTrendingUp className="mr-1" aria-hidden="true" />
                    <span className="text-2xl font-bold">
                      {formatPercent(metrics.totalAnnualReturnPct)}
                    </span>
                  </div>
                </div>
              </div>

              <dl className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <dt className="text-secondary-600">Gross rental yield</dt>
                  <dd className="font-medium">{formatPercent(metrics.grossYieldPct)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary-600">Net rental yield</dt>
                  <dd className="font-medium">{formatPercent(metrics.netYieldPct)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary-600">Projected appreciation</dt>
                  <dd className="font-medium">{formatPercent(metrics.appreciationPct)}</dd>
                </div>
              </dl>

              <div className="mb-6">
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
                    className="bg-primary-600 h-2 rounded-full"
                    style={{ width: toBarWidth(metrics.fundedPct) }}
                  />
                </div>
                <p className="text-sm text-secondary-500 mt-1">
                  Minimum investment: {formatUsd(metrics.minInvestmentUsd)}
                </p>
              </div>

              <Link to="/property-3d" className="btn w-full mb-4 flex items-center justify-center">
                <FiGrid className="mr-2" aria-hidden="true" />
                View in 3D
              </Link>

              <button type="button" className="btn w-full mb-4 flex items-center justify-center">
                <FaWallet className="mr-2" aria-hidden="true" />
                Connect wallet to invest
              </button>

              <div className="flex items-center justify-center space-x-4 pt-4 border-t">
                <FacebookShareButton url={shareUrl} aria-label="Share on Facebook">
                  <FaFacebook className="text-2xl text-blue-600 hover:opacity-80" />
                </FacebookShareButton>
                <TwitterShareButton url={shareUrl} aria-label="Share on X">
                  <FaTwitter className="text-2xl text-sky-500 hover:opacity-80" />
                </TwitterShareButton>
                <LinkedinShareButton url={shareUrl} aria-label="Share on LinkedIn">
                  <FaLinkedin className="text-2xl text-blue-700 hover:opacity-80" />
                </LinkedinShareButton>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center space-x-4 mb-4">
                <img
                  src={advisor.image}
                  alt=""
                  className="w-16 h-16 rounded-full object-cover"
                  loading="lazy"
                />
                <div>
                  <h2 className="font-semibold">{advisor.name}</h2>
                  <p className="text-sm text-secondary-600">{advisor.title}</p>
                </div>
              </div>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="inline font-medium">Phone: </dt>
                  <dd className="inline">
                    <a href={`tel:${advisor.phone.replace(/[^\d+]/g, '')}`} className="hover:text-primary-600">
                      {advisor.phone}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">Email: </dt>
                  <dd className="inline">
                    <a href={`mailto:${advisor.email}`} className="hover:text-primary-600 break-all">
                      {advisor.email}
                    </a>
                  </dd>
                </div>
              </dl>
              <button type="button" className="btn-secondary w-full mt-4 justify-center">
                Schedule consultation
              </button>
            </div>
          </motion.aside>
        </div>
      </div>
    </div>
  );
}

export default PropertyDetail;
